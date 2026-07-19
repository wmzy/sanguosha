// src/ai-mcp/mcpServer.ts
// 最小 MCP server 请求分发（JSON-RPC 2.0 over stdio 的可测试核心）。
//
// 不依赖 @modelcontextprotocol/sdk（v1.29.0 的 exports map 对 McpServer/StdioServerTransport
// 不可达，属发布缺陷）。手写 JSON-RPC 分发，覆盖 MCP stdio 协议必需方法：
//   initialize / notifications/initialized / tools/list / tools/call
//
// 工具集：
//   - createRoom / joinRoom / spectateRoom：启动工具（建/加入/旁观房间 + ready）
//   - play：决策 + 等待（lobby→playing 推进、action 执行）
//   - getSnapshot / getSkillInfo / reportBug：只读辅助
//
// 启动工具的 roomId 在 schema 层面 required（joinRoom/spectateRoom），
// 避免过去 LLM 漏传 roomId 时静默回退为建房的问题。
import { runPlay, type PlayState } from './playHandler';
import { projectView } from './viewProjector';
import { reportBugResult, type ReportBugInput } from './feedbackHandler';
import { getSkillDescriptionAsync } from '../engine/skill';
import type { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { ClientMessage as EngineClientMessage } from '../engine/types';

const PROTOCOL_VERSION = '2024-11-05';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// ──────────────────────────────────────────────────────────────────────────
// 工具 schema
// ──────────────────────────────────────────────────────────────────────────

/** createRoom 工具：建房做房主，进入 lobby 等待他人加入。 */
export const CREATE_ROOM_TOOL = {
  name: 'createRoom',
  description:
    '建房做房主并发起准备，进入 lobby 等待其他玩家加入。返回 roomId（房间码）——你是房主，' +
    '请把它告诉人类或其他 AI 让他们用 joinRoom 加入。后续持续调用 play 推进开局（lobby→playing）。' +
    '同一 MCP 连接只能调用一次启动工具（createRoom / joinRoom / spectateRoom 三选一）。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: '房间名（可选，默认随机生成）' },
      maxPlayers: { type: 'number', description: '最大人数，默认 2' },
      playerId: { type: 'string', description: '指定玩家 id，否则服务端自动生成' },
      timeoutScale: {
        type: 'number',
        description: 'pending 超时倍率。1=默认；>1 更慢（应对慢 API）； Infinity=无限等待',
      },
    },
  },
};

/** joinRoom 工具：加入指定房间。roomId 在 schema 层 required，MCP client 会强制 LLM 传入。 */
export const JOIN_ROOM_TOOL = {
  name: 'joinRoom',
  description:
    '加入指定房间并发起准备。roomId 必填——从对话历史、/play 命令参数或房主分享获取。' +
    '加入后用 play 工具推进开局。同一 MCP 连接只能调用一次启动工具。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      roomId: { type: 'string', description: '要加入的房间码（必填）' },
      playerId: { type: 'string', description: '指定玩家 id，否则服务端自动生成' },
      timeoutScale: {
        type: 'number',
        description: 'pending 超时倍率。1=默认；>1 更慢（应对慢 API）； Infinity=无限等待',
      },
    },
    required: ['roomId'],
  },
};

/** spectateRoom 工具：以旁观者身份加入，不占座次。 */
export const SPECTATE_ROOM_TOOL = {
  name: 'spectateRoom',
  description:
    '以旁观者身份加入房间，不占座次。roomId 必填。旁观者不准备、不开局，仅观察。' +
    '后续用 play 工具获取视图。同一 MCP 连接只能调用一次启动工具。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      roomId: { type: 'string', description: '要旁观的房间码（必填）' },
      playerId: { type: 'string', description: '指定玩家 id，否则服务端自动生成' },
    },
    required: ['roomId'],
  },
};

/** play 工具：决策 + 等待。无 startGame 参数——首次调用前必须先调 createRoom/joinRoom/spectateRoom。 */
export const PLAY_TOOL = {
  name: 'play',
  description:
    '执行一个操作并阻塞等待直到轮到本座次决策或游戏结束。' +
    '首次调用前必须先用 createRoom / joinRoom / spectateRoom 启动；' +
    '启动后持续调用 play（不带 action = 纯等待 / 推进 lobby→playing）。' +
    'action 从上次返回的 availableActions 取一条。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'object',
        description: '要执行的操作（从上次返回的 availableActions 取）',
        properties: {
          skillId: { type: 'string' },
          actionType: { type: 'string' },
          ownerId: { type: 'number' },
          params: { type: 'object' },
          baseSeq: { type: 'number' },
        },
      },
      waitTimeoutMs: { type: 'number', description: '本次等待总超时(ms)，默认 25000' },
    },
  },
};

/** getSnapshot 工具的输入 schema:按需获取完整游戏视图快照。无输入参数。 */
export const GET_SNAPSHOT_TOOL = {
  name: 'getSnapshot',
  description:
    '获取当前完整游戏视图快照（全部玩家状态、手牌数、装备、区域等）。' +
    'play 工具返回增量状态(stateDiff)，当因上下文压缩丢失基线、' +
    '或需要一次性查看全部信息时调用本工具校准。',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

/** getSkillInfo 工具的输入 schema:按名称查询技能/卡牌效果描述。 */
export const SKILL_INFO_TOOL = {
  name: 'getSkillInfo',
  description:
    '查询三国杀技能或卡牌的效果描述。传入技能/卡牌名称(如"杀""制衡""顺手牵羊""丈八蛇矛"),' +
    '返回每个名称的描述文案。当需要理解 view 中某个技能/卡牌的作用、或不确定某张牌如何结算时调用。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      names: {
        type: 'array',
        items: { type: 'string' },
        description: '技能/卡牌名称数组(对应 view.players[].skills 与卡牌名)',
        minItems: 1,
      },
    },
    required: ['names'],
  },
};

/** reportBug 工具的输入 schema:agent 对局中发现 bug 时落盘反馈。 */
export const REPORT_BUG_TOOL = {
  name: 'reportBug',
  description:
    'AI agent 在三国杀对局中发现 bug 时调用:把问题描述 + 结构化字段 + 当时的游戏状态快照写入本地 JSON 文件。' +
    '不影响游戏进程。返回文件路径和 id。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      description: { type: 'string', description: 'bug 描述,自由文本' },
      severity: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: '严重程度,默认 medium',
      },
      category: {
        type: 'string',
        enum: ['skill-settlement', 'state-inconsistency', 'ui', 'rule-violation', 'other'],
        description: '分类,默认 other',
      },
      expected: { type: 'string', description: '期望行为(可选)' },
      actual: { type: 'string', description: '实际行为(可选)' },
    },
    required: ['description'],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 启动 opts 类型
// ──────────────────────────────────────────────────────────────────────────

export interface CreateRoomOpts {
  name?: string;
  maxPlayers?: number;
  playerId?: string;
  timeoutScale?: number;
}

export interface JoinRoomOpts {
  roomId: string;
  playerId?: string;
  timeoutScale?: number;
}

export interface SpectateRoomOpts {
  roomId: string;
  playerId?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// ctx 接口
// ──────────────────────────────────────────────────────────────────────────

export interface McpHandlerContext {
  hgc: HeadlessGameClient;
  /** 建房做房主（幂等：重复调用且角色相同为 no-op；角色不同抛错） */
  doCreateRoom: (opts: CreateRoomOpts) => Promise<void>;
  /** 加入指定房间（幂等） */
  doJoinRoom: (opts: JoinRoomOpts) => Promise<void>;
  /** 以旁观者身份加入（幂等） */
  doSpectateRoom: (opts: SpectateRoomOpts) => Promise<void>;
  /** 推进 lobby→playing（5s 短超时；play 工具内部调用）。旁观者 no-op。 */
  advanceLobby: () => Promise<void>;
  /** 是否已调用过任一启动工具 */
  isStarted: () => boolean;
  /** 默认座次（baseSeq/ownerId 占位回填用） */
  seat: number;
  /** play 工具跨调用状态（维护 lastView 用于增量 diff） */
  playState: PlayState;
}

// ──────────────────────────────────────────────────────────────────────────
// 参数解析
// ──────────────────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function optString(o: Record<string, unknown>, key: string): string | undefined {
  return typeof o[key] === 'string' ? (o[key] as string) : undefined;
}

function optNumber(o: Record<string, unknown>, key: string): number | undefined {
  return typeof o[key] === 'number' ? (o[key] as number) : undefined;
}

function parseCreateRoomOpts(args: unknown): CreateRoomOpts {
  const o = asRecord(args);
  return {
    name: optString(o, 'name'),
    maxPlayers: optNumber(o, 'maxPlayers'),
    playerId: optString(o, 'playerId'),
    timeoutScale: optNumber(o, 'timeoutScale'),
  };
}

function parseJoinRoomOpts(args: unknown): JoinRoomOpts {
  const o = asRecord(args);
  const roomId = optString(o, 'roomId');
  if (!roomId) {
    throw new Error(
      'joinRoom 需要 roomId。如果你是要建房做房主，请改用 createRoom 工具；' +
        '如果是要加入人类已建好的房间，请从对话历史或 /play 命令取出房间码后重试。',
    );
  }
  return {
    roomId,
    playerId: optString(o, 'playerId'),
    timeoutScale: optNumber(o, 'timeoutScale'),
  };
}

function parseSpectateRoomOpts(args: unknown): SpectateRoomOpts {
  const o = asRecord(args);
  const roomId = optString(o, 'roomId');
  if (!roomId) {
    throw new Error('spectateRoom 需要 roomId。');
  }
  return {
    roomId,
    playerId: optString(o, 'playerId'),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// getSkillInfo 辅助
// ──────────────────────────────────────────────────────────────────────────

/** getSkillInfo 工具的结果项:name 恒返回,description 缺失为 null(供 AI 区分"查无"与"无描述")。 */
export interface SkillInfoEntry {
  name: string;
  description: string | null;
}

/** 并发查询多个技能名描述;输入归一化(非数组/非字符串过滤)。 */
async function getSkillInfoResult(names: unknown): Promise<SkillInfoEntry[]> {
  const arr = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
  return Promise.all(
    arr.map(async (name) => {
      const desc = await getSkillDescriptionAsync(name);
      return { name, description: desc ?? null };
    }),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 启动工具响应构造
// ──────────────────────────────────────────────────────────────────────────

interface StartupResult {
  ok: true;
  roomId: string | null;
  playerId: string | null;
  isHost: boolean;
  joinedAs: 'host' | 'guest' | 'spectator';
  phase: 'lobby' | 'playing' | 'ended';
}

function startupResult(hgc: HeadlessGameClient, role: 'host' | 'guest' | 'spectator'): StartupResult {
  const phase: StartupResult['phase'] =
    hgc.phase === 'ended' ? 'ended' : hgc.phase === 'playing' ? 'playing' : 'lobby';
  return {
    ok: true,
    roomId: hgc.roomId,
    playerId: hgc.playerId,
    isHost: role === 'host',
    joinedAs: role,
    phase,
  };
}

function okResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  const text = JSON.stringify(result);
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text }], structuredContent: result },
  };
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ──────────────────────────────────────────────────────────────────────────
// 分发
// ──────────────────────────────────────────────────────────────────────────

const TOOLS = [
  PLAY_TOOL,
  CREATE_ROOM_TOOL,
  JOIN_ROOM_TOOL,
  SPECTATE_ROOM_TOOL,
  GET_SNAPSHOT_TOOL,
  SKILL_INFO_TOOL,
  REPORT_BUG_TOOL,
];

/**
 * 处理一条 JSON-RPC 请求，返回响应（通知无 id 时返回 null）。
 * play 工具调用是 async（阻塞等待），故本函数返回 Promise。
 */
export async function handleMcpRequest(
  req: JsonRpcRequest,
  ctx: McpHandlerContext,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  // 通知（无 id）：notifications/initialized 等，无需响应
  if (req.id === undefined) {
    return null;
  }

  try {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'sanguosha-ai', version: '0.1.0' },
          },
        };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const toolName = params.name;

        // ── 启动工具 ──
        if (toolName === 'createRoom') {
          await ctx.doCreateRoom(parseCreateRoomOpts(params.arguments));
          return okResponse(id, startupResult(ctx.hgc, 'host'));
        }
        if (toolName === 'joinRoom') {
          await ctx.doJoinRoom(parseJoinRoomOpts(params.arguments));
          return okResponse(id, startupResult(ctx.hgc, 'guest'));
        }
        if (toolName === 'spectateRoom') {
          await ctx.doSpectateRoom(parseSpectateRoomOpts(params.arguments));
          return okResponse(id, startupResult(ctx.hgc, 'spectator'));
        }

        // ── 只读辅助工具 ──
        if (toolName === 'getSnapshot') {
          const view = ctx.hgc.view ? projectView(ctx.hgc.view) : null;
          return okResponse(id, { view });
        }
        if (toolName === 'getSkillInfo') {
          const results = await getSkillInfoResult(params.arguments?.names);
          return okResponse(id, { skills: results });
        }
        if (toolName === 'reportBug') {
          const args = asRecord(params.arguments);
          const description = typeof args['description'] === 'string' ? args['description'] : '';
          if (!description.trim()) {
            return errorResponse(id, -32602, 'description is required');
          }
          const input: ReportBugInput = {
            description,
            severity: args['severity'] as ReportBugInput['severity'],
            category: args['category'] as ReportBugInput['category'],
            expected: optString(args, 'expected'),
            actual: optString(args, 'actual'),
          };
          const result = await reportBugResult(input, ctx.hgc);
          return okResponse(id, result);
        }

        // ── play 工具 ──
        if (toolName !== 'play') {
          return errorResponse(id, -32601, `unknown tool: ${toolName}`);
        }
        if (!ctx.isStarted()) {
          return errorResponse(
            id,
            -32602,
            'play 工具需要先调用 createRoom / joinRoom / spectateRoom 启动。' +
              '建房做房主用 createRoom；加入已有房间用 joinRoom（roomId 必填）；旁观用 spectateRoom。',
          );
        }
        await ctx.advanceLobby();
        const args = asRecord(params.arguments);
        const action = args['action'] as
          | {
              skillId?: string;
              actionType?: string;
              ownerId?: number;
              params?: Record<string, unknown>;
            }
          | undefined;
        const result = await runPlay(ctx.hgc, {
          action: action?.skillId
            ? {
                message: {
                  ...(action as EngineClientMessage),
                  ownerId: action.ownerId ?? ctx.hgc.seatIndex,
                },
              }
            : undefined,
          waitTimeoutMs: optNumber(args, 'waitTimeoutMs'),
          state: ctx.playState,
        });
        return okResponse(id, result);
      }
      default:
        return errorResponse(id, -32601, `method not found: ${req.method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResponse(id, -32603, msg);
  }
}
