// tests/ai-mcp/mcpServer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleMcpRequest, PLAY_TOOL, SKILL_INFO_TOOL, type McpHandlerContext } from '../../src/ai-mcp/mcpServer';
import '../../src/engine/skills';
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

  it('tools/list 返回 play 与 getSkillInfo 工具定义', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
    const tools = (res!.result as { tools: typeof PLAY_TOOL[] }).tools;
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['play', 'getSkillInfo']);
    expect(tools[0].inputSchema).toBeDefined();
    expect(tools[1].inputSchema).toBeDefined();
    expect(SKILL_INFO_TOOL.inputSchema).toBeDefined();
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

  it('tools/call getSkillInfo 返回技能描述(结构化 + text)', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'getSkillInfo', arguments: { names: ['杀', '制衡'] } } },
      ctx,
    );
    const result = res!.result as { content: { text: string }[]; structuredContent: { skills: { name: string; description: string | null }[] } };
    const sc = result.structuredContent;
    expect(sc.skills).toHaveLength(2);
    expect(sc.skills[0]).toMatchObject({ name: '杀' });
    expect(sc.skills[0].description).toBeTypeOf('string');
    expect(sc.skills[0].description!.length).toBeGreaterThan(0);
    expect(sc.skills[1].name).toBe('制衡');
    expect(result.content[0].text).toContain('杀');
  });

  it('getSkillInfo 对不存在的名称返回 description null', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'getSkillInfo', arguments: { names: ['__无此技能__'] } } },
      ctx,
    );
    const result = res!.result as { structuredContent: { skills: { name: string; description: null }[] } };
    expect(result.structuredContent.skills).toEqual([{ name: '__无此技能__', description: null }]);
  });

  it('startGame=true 规范为 debug 模式 opts 传给 ensureStarted', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'play', arguments: { startGame: true } } },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalledTimes(1);
    expect(ensureStarted).toHaveBeenCalledWith({ mode: 'debug' });
  });

  it('startGame={mode:multiplayer,roomId} 规范后传给 ensureStarted', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'play', arguments: { startGame: { mode: 'multiplayer', roomId: 'ABC123', playerId: 'ai-1' } } } },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalledTimes(1);
    expect(ensureStarted).toHaveBeenCalledWith({ mode: 'multiplayer', roomId: 'ABC123', name: undefined, maxPlayers: undefined, playerId: 'ai-1', readyTimeoutMs: undefined });
  });

  it('startGame={mode:multiplayer} 建房模式(无 roomId)', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'play', arguments: { startGame: { mode: 'multiplayer', name: '测试房', maxPlayers: 4 } } } },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalledWith({ mode: 'multiplayer', roomId: undefined, name: '测试房', maxPlayers: 4, playerId: undefined, readyTimeoutMs: undefined });
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
