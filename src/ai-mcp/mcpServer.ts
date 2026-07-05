// src/ai-mcp/mcpServer.ts
// 最小 MCP server 请求分发（JSON-RPC 2.0 over stdio 的可测试核心）。
//
// 不依赖 @modelcontextprotocol/sdk（v1.29.0 的 exports map 对 McpServer/StdioServerTransport
// 不可达，属发布缺陷）。手写 JSON-RPC 分发，覆盖 MCP stdio 协议必需方法：
//   initialize / notifications/initialized / tools/list / tools/call
//
// MCP stdio 传输：每行一条 JSON-RPC 消息（NDJSON）。响应写到 stdout，日志写到 stderr。
import { runPlay } from './playHandler';
import { reportBugResult, type ReportBugInput } from './feedbackHandler';
import { getSkillDescriptionAsync } from '../engine/skill';
import type { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { ClientMessage as EngineClientMessage } from '../engine/types';

const PROTOCOL_VERSION = '2024-11-05';

/** 把 startGame 参数(boolean | object)归一化为 StartGameOpts。 */
export function normalizeStartGame(raw: unknown): StartGameOpts {
  if (raw === true || raw === undefined) {
    // 旧 debug 默认
    return { mode: 'debug' };
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const mode = o['mode'] === 'multiplayer' ? 'multiplayer' : 'debug';
  if (mode === 'debug') {
    return {
      mode: 'debug',
      roomId: typeof o['roomId'] === 'string' ? o['roomId'] : undefined,
      playerCount: typeof o['playerCount'] === 'number' ? o['playerCount'] : undefined,
    };
  }
  return {
    mode: 'multiplayer',
    roomId: typeof o['roomId'] === 'string' ? o['roomId'] : undefined,
    name: typeof o['name'] === 'string' ? o['name'] : undefined,
    maxPlayers: typeof o['maxPlayers'] === 'number' ? o['maxPlayers'] : undefined,
    playerId: typeof o['playerId'] === 'string' ? o['playerId'] : undefined,
    readyTimeoutMs: typeof o['readyTimeoutMs'] === 'number' ? o['readyTimeoutMs'] : undefined,
  };
}

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

/** play 工具的输入 schema（MCP tool inputSchema 用 JSON Schema 表达）。 */
export const PLAY_TOOL = {
  name: 'play',
  description:
    '驱动一个三国杀座次：执行一个操作并阻塞等待直到轮到本座次决策或游戏结束。' +
    '首次调用传 startGame 创建/加入房间并开始游戏。' +
    'action 从上次返回的 availableActions 取一条；省略 action 表示纯等待。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      startGame: {
        oneOf: [
          { type: 'boolean', description: 'true=旧 debug 模式(创建 debug 房)' },
          {
            type: 'object',
            description: '多人模式开局控制',
            properties: {
              mode: {
                type: 'string',
                enum: ['multiplayer', 'debug'],
                description: 'multiplayer=普通多人房(默认); debug=调试房',
              },
              roomId: { type: 'string', description: 'join 指定房间;省略则建房(房主)' },
              name: { type: 'string', description: '建房时的房间名' },
              maxPlayers: { type: 'number', description: '最大人数,默认 2' },
              playerId: { type: 'string', description: '玩家 id,给定则采用,否则自动生成' },
              readyTimeoutMs: { type: 'number', description: '等待全员就绪超时(ms)' },
            },
          },
        ],
        description: '首次调用：创建/加入房间并开始游戏。',
      },
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
      waitTimeoutMs: { type: 'number', description: '本次等待总超时(ms)，默认 120000' },
    },
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

export interface McpHandlerContext {
  hgc: HeadlessGameClient;
  /** 启动房间（创建/加入 + ready + 必要时 start）。幂等。 */
  ensureStarted: (opts?: StartGameOpts) => Promise<void>;
  /** 默认座次（baseSeq/ownerId 占位回填用） */
  seat: number;
}

export type StartGameOpts =
  | { mode: 'debug'; roomId?: string; playerCount?: number }
  | {
      mode: 'multiplayer';
      roomId?: string;
      name?: string;
      maxPlayers?: number;
      playerId?: string;
      readyTimeoutMs?: number;
    };

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
        return { jsonrpc: '2.0', id, result: { tools: [PLAY_TOOL, SKILL_INFO_TOOL, REPORT_BUG_TOOL] } };
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (params.name === 'getSkillInfo') {
          const results = await getSkillInfoResult(params.arguments?.names);
          const text = JSON.stringify({ skills: results });
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }], structuredContent: { skills: results } },
          };
        }
        if (params.name === 'reportBug') {
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const description = typeof args.description === 'string' ? args.description : '';
          if (!description.trim()) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'description is required' },
            };
          }
          const input: ReportBugInput = {
            description,
            severity: args.severity as ReportBugInput['severity'],
            category: args.category as ReportBugInput['category'],
            expected: typeof args.expected === 'string' ? args.expected : undefined,
            actual: typeof args.actual === 'string' ? args.actual : undefined,
          };
          const result = await reportBugResult(input, ctx.hgc);
          const text = JSON.stringify(result);
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }], structuredContent: result },
          };
        }
        if (params.name !== 'play') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `unknown tool: ${params.name}` },
          };
        }
        const args = params.arguments ?? {};
        if (args.startGame) await ctx.ensureStarted(normalizeStartGame(args.startGame));
        const action = args.action as
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
                  ownerId: action.ownerId ?? ctx.seat,
                },
              }
            : undefined,
          waitTimeoutMs: typeof args.waitTimeoutMs === 'number' ? args.waitTimeoutMs : undefined,
        });
        const text = JSON.stringify(result);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text }], structuredContent: result },
        };
      }
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `method not found: ${req.method}` },
        };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { jsonrpc: '2.0', id, error: { code: -32603, message: msg } };
  }
}
