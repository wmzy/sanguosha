// tests/ai-mcp/mcpServer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleMcpRequest, PLAY_TOOL, type McpHandlerContext } from '../../src/ai-mcp/mcpServer';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';

function makeFakeHgc(overrides: Partial<HeadlessGameClient> = {}): HeadlessGameClient {
  return {
    phase: 'playing',
    needsAction: () => true,
    gameOverWinner: null,
    view: null,
    getAvailableActions: () => [],
    drainNewEvents: () => [],
    sendAction: vi.fn(),
    consumeActionRejected: () => false,
    ...overrides,
  } as unknown as HeadlessGameClient;
}

function makeCtx(hgc: HeadlessGameClient, ensureStarted = vi.fn()): McpHandlerContext {
  return { hgc, ensureStarted, seat: 0 };
}

describe('handleMcpRequest', () => {
  it('initialize 返回协议版本与 tools 能力', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, ctx);
    expect(res).not.toBeNull();
    expect(res!.result).toMatchObject({
      capabilities: { tools: {} },
      serverInfo: { name: 'sanguosha-ai' },
    });
    expect((res!.result as { protocolVersion: string }).protocolVersion).toBeTruthy();
  });

  it('tools/list 返回 play 工具定义', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
    const tools = (res!.result as { tools: typeof PLAY_TOOL[] }).tools;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('play');
    expect(tools[0].inputSchema).toBeDefined();
  });

  it('tools/call play 执行 action 并返回结构化结果', async () => {
    const hgc = makeFakeHgc();
    const ctx = makeCtx(hgc);
    const action = { skillId: '杀', actionType: 'use', ownerId: 0, params: { cardId: 'c1', targets: [1] }, baseSeq: 0 };
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'play', arguments: { action } } },
      ctx,
    );
    expect(hgc.sendAction).toHaveBeenCalledWith(action);
    const result = res!.result as { content: { text: string }[]; structuredContent: { lastActionResult: string } };
    expect(result.content[0].text).toBeTypeOf('string');
    expect(result.structuredContent.lastActionResult).toBe('accepted');
  });

  it('startGame=true 触发 ensureStarted', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'play', arguments: { startGame: true } } },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalled();
  });

  it('未知工具返回 error', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } },
      ctx,
    );
    expect(res!.error).toBeDefined();
    expect(res!.error!.code).toBe(-32601);
  });

  it('通知（无 id）返回 null', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx);
    expect(res).toBeNull();
  });

  it('未知方法返回 -32601', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 6, method: 'foo/bar' }, ctx);
    expect(res!.error!.code).toBe(-32601);
  });
});
