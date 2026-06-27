// src/ai-mcp/mcpServer.ts
// 最小 MCP server 请求分发（JSON-RPC 2.0 over stdio 的可测试核心）。
//
// 不依赖 @modelcontextprotocol/sdk（v1.29.0 的 exports map 对 McpServer/StdioServerTransport
// 不可达，属发布缺陷）。手写 JSON-RPC 分发，覆盖 MCP stdio 协议必需方法：
//   initialize / notifications/initialized / tools/list / tools/call
//
// MCP stdio 传输：每行一条 JSON-RPC 消息（NDJSON）。响应写到 stdout，日志写到 stderr。
import { runPlay } from './playHandler';
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

/** play 工具的输入 schema（MCP tool inputSchema 用 JSON Schema 表达）。 */
export const PLAY_TOOL = {
  name: 'play',
  description:
    '驱动一个三国杀座次：执行一个操作并阻塞等待直到轮到本座次决策或游戏结束。' +
    '首次调用传 {startGame:true} 创建/加入房间并开始游戏。' +
    'action 从上次返回的 availableActions 取一条；省略 action 表示纯等待。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      startGame: { type: 'boolean', description: '首次调用：创建/加入房间并开始游戏' },
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

export interface McpHandlerContext {
  hgc: HeadlessGameClient;
  /** 启动房间（创建/加入 + ready + 必要时 start）。幂等。 */
  ensureStarted: () => Promise<void>;
  /** 默认座次（baseSeq/ownerId 占位回填用） */
  seat: number;
}

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
        return { jsonrpc: '2.0', id, result: { tools: [PLAY_TOOL] } };
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (params.name !== 'play') {
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${params.name}` } };
        }
        const args = params.arguments ?? {};
        if (args.startGame) await ctx.ensureStarted();
        const action = args.action as { skillId?: string; actionType?: string; ownerId?: number; params?: Record<string, unknown> } | undefined;
        const result = await runPlay(ctx.hgc, {
          action: action && action.skillId
            ? { message: { ...(action as EngineClientMessage), ownerId: action.ownerId ?? ctx.seat } }
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
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${req.method}` } };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { jsonrpc: '2.0', id, error: { code: -32603, message: msg } };
  }
}


