// tests/ai-mcp/mcpServer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  handleMcpRequest,
  normalizeStartGame,
  PLAY_TOOL,
  SKILL_INFO_TOOL,
  REPORT_BUG_TOOL,
  type McpHandlerContext,
} from '../../src/ai-mcp/mcpServer';
import '../../src/engine/skills';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import {
  reportBugResult,
  resolveFeedbackDir,
} from '../../src/ai-mcp/feedbackHandler';

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

  it('tools/list 返回 play、getSkillInfo、reportBug 工具定义', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
    const tools = (res!.result as { tools: (typeof PLAY_TOOL)[] }).tools;
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(['play', 'getSkillInfo', 'reportBug']);
    expect(tools[0].inputSchema).toBeDefined();
    expect(tools[1].inputSchema).toBeDefined();
    expect(tools[2].inputSchema).toBeDefined();
    expect(SKILL_INFO_TOOL.inputSchema).toBeDefined();
    expect(REPORT_BUG_TOOL.inputSchema).toBeDefined();
  });

  it('tools/call play 执行 action 并返回结构化结果', async () => {
    const hgc = makeFakeHgc();
    const ctx = makeCtx(hgc);
    const action = {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: 'c1', targets: [1] },
      baseSeq: 0,
    };
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'play', arguments: { action } },
      },
      ctx,
    );
    expect(hgc.sendAction).toHaveBeenCalledWith(action);
    const result = res!.result as {
      content: { text: string }[];
      structuredContent: { lastActionResult: string };
    };
    expect(result.content[0].text).toBeTypeOf('string');
    expect(result.structuredContent.lastActionResult).toBe('accepted');
  });

  it('tools/call getSkillInfo 返回技能描述(结构化 + text)', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'getSkillInfo', arguments: { names: ['杀', '制衡'] } },
      },
      ctx,
    );
    const result = res!.result as {
      content: { text: string }[];
      structuredContent: { skills: { name: string; description: string | null }[] };
    };
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
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'getSkillInfo', arguments: { names: ['__无此技能__'] } },
      },
      ctx,
    );
    const result = res!.result as {
      structuredContent: { skills: { name: string; description: null }[] };
    };
    expect(result.structuredContent.skills).toEqual([{ name: '__无此技能__', description: null }]);
  });

  it('startGame=true 规范为 debug 模式 opts 传给 ensureStarted', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'play', arguments: { startGame: true } },
      },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalledTimes(1);
    expect(ensureStarted).toHaveBeenCalledWith({ mode: 'debug' });
  });

  it('startGame={mode:multiplayer,roomId} 规范后传给 ensureStarted', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'play',
          arguments: { startGame: { mode: 'multiplayer', roomId: 'ABC123', playerId: 'ai-1' } },
        },
      },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalledTimes(1);
    expect(ensureStarted).toHaveBeenCalledWith({
      mode: 'multiplayer',
      roomId: 'ABC123',
      name: undefined,
      maxPlayers: undefined,
      playerId: 'ai-1',
      readyTimeoutMs: undefined,
    });
  });

  it('startGame={mode:multiplayer} 建房模式(无 roomId)', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'play',
          arguments: { startGame: { mode: 'multiplayer', name: '测试房', maxPlayers: 4 } },
        },
      },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalledWith({
      mode: 'multiplayer',
      roomId: undefined,
      name: '测试房',
      maxPlayers: 4,
      playerId: undefined,
      readyTimeoutMs: undefined,
    });
  });

  it('startGame={mode:multiplayer,timeoutScale} 解析并传给 ensureStarted', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'play',
          arguments: { startGame: { mode: 'multiplayer', timeoutScale: 5 } },
        },
      },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'multiplayer', timeoutScale: 5 }),
    );
  });

  it('startGame={mode:debug,timeoutScale} 解析并传给 ensureStarted', async () => {
    const ensureStarted = vi.fn();
    const ctx = makeCtx(makeFakeHgc(), ensureStarted);
    await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'play',
          arguments: { startGame: { mode: 'debug', timeoutScale: 2 } },
        },
      },
      ctx,
    );
    expect(ensureStarted).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'debug', timeoutScale: 2 }),
    );
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
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('未知方法返回 -32601', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 6, method: 'foo/bar' }, ctx);
    expect(res!.error!.code).toBe(-32601);
  });

  it('tools/call reportBug 返回 ok 且文件落盘', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const hgc = makeFakeHgc({ view: null, phase: 'playing', roomId: 'R1' });
      const ctx = makeCtx(hgc);
      const res = await handleMcpRequest(
        {
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: {
            name: 'reportBug',
            arguments: {
              description: '杀的伤害没结算',
              severity: 'high',
              category: 'skill-settlement',
              expected: '掉 1 血',
              actual: '没掉血',
            },
          },
        },
        ctx,
      );
      expect(res).not.toBeNull();
      const sc = (res!.result as { structuredContent: { ok: boolean; id: string; path: string; timestamp: string } }).structuredContent;
      expect(sc.ok).toBe(true);
      const content = JSON.parse(await fs.readFile(sc.path, 'utf8'));
      expect(content.description).toBe('杀的伤害没结算');
      expect(content.severity).toBe('high');
      expect(content.expected).toBe('掉 1 血');
      expect(content.actual).toBe('没掉血');
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('tools/call reportBug 缺 description 返回 -32602', async () => {
    const ctx = makeCtx(makeFakeHgc({ view: null }));
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'reportBug', arguments: { severity: 'high' } },
      },
      ctx,
    );
    expect(res!.error).toBeDefined();
    expect(res!.error!.code).toBe(-32602);
  });

  it('PLAY_TOOL schema 含 timeoutScale 字段', () => {
    const props = (
      PLAY_TOOL.inputSchema.properties.startGame as {
        oneOf: { properties: Record<string, unknown> }[];
      }
    ).oneOf[1].properties;
    expect(props).toHaveProperty('timeoutScale');
    expect((props.timeoutScale as { type: string }).type).toBe('number');
  });
});

describe('normalizeStartGame', () => {
  it('debug 模式解析 timeoutScale', () => {
    const opts = normalizeStartGame({ mode: 'debug', timeoutScale: 3 });
    expect(opts).toMatchObject({ mode: 'debug', timeoutScale: 3 });
  });

  it('multiplayer 模式解析 timeoutScale', () => {
    const opts = normalizeStartGame({ mode: 'multiplayer', timeoutScale: 5 });
    expect(opts).toMatchObject({ mode: 'multiplayer', timeoutScale: 5 });
  });

  it('Infinity 作为 timeoutScale 合法', () => {
    const opts = normalizeStartGame({ mode: 'multiplayer', timeoutScale: Infinity });
    expect(opts).toMatchObject({ mode: 'multiplayer', timeoutScale: Infinity });
  });

  it('未提供 timeoutScale 时为 undefined(不干扰默认路径)', () => {
    const opts = normalizeStartGame({ mode: 'multiplayer', roomId: 'X' });
    expect(opts).toMatchObject({ mode: 'multiplayer', roomId: 'X' });
    expect((opts as { timeoutScale?: number }).timeoutScale).toBeUndefined();
  });

  it('非数字 timeoutScale 被忽略为 undefined', () => {
    const opts = normalizeStartGame({ mode: 'multiplayer', timeoutScale: 'fast' });
    expect((opts as { timeoutScale?: number }).timeoutScale).toBeUndefined();
  });
});
function makeStubView() {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: 'play',
    turn: { round: 1 },
    players: [],
    pending: null,
    zones: { deckCount: 10, discardPileCount: 0 },
    log: [],
  } as unknown as Parameters<typeof import('../../src/ai-mcp/viewProjector').projectView>[0];
}

describe('reportBugResult', () => {
  it('写入文件包含 agent 字段和自动快照', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const drainNewEvents = vi.fn(() => []);
      const hgc = makeFakeHgc({
        view: makeStubView(),
        getAvailableActions: () => [
          { description: 'x', message: {} as never, validTargets: [], category: 'play' },
        ],
        drainNewEvents,
        roomId: 'ROOM1',
        seatIndex: 0,
        phase: 'playing',
      });
      const res = await reportBugResult(
        { description: 'bug X', severity: 'high', category: 'skill-settlement' },
        hgc,
      );
      expect(res.ok).toBe(true);
      expect(res.id).toMatch(/^[A-Za-z0-9]{6}$/);
      const content = JSON.parse(await fs.readFile(res.path, 'utf8'));
      expect(content.description).toBe('bug X');
      expect(content.severity).toBe('high');
      expect(content.category).toBe('skill-settlement');
      expect(content.reporter.roomId).toBe('ROOM1');
      expect(content.reporter.seat).toBe(0);
      expect(content.reporter.phase).toBe('playing');
      expect(content.snapshot.view).not.toBeNull();
      expect(content.snapshot.availableActions).toHaveLength(1);
      // 关键:reportBug 不得调用消费式 drainNewEvents
      expect(drainNewEvents).not.toHaveBeenCalled();
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('view 为 null 时 snapshot.view 为 null 仍落盘,severity/category 走默认', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const hgc = makeFakeHgc({ view: null, phase: 'lobby' });
      const res = await reportBugResult({ description: 'lobby bug' }, hgc);
      const content = JSON.parse(await fs.readFile(res.path, 'utf8'));
      expect(content.snapshot.view).toBeNull();
      expect(content.severity).toBe('medium');
      expect(content.category).toBe('other');
      expect(content.reporter.phase).toBe('lobby');
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('目录不存在时自动创建(嵌套)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    const nested = path.join(tmpDir, 'nested', 'dir');
    process.env.SGS_FEEDBACK_DIR = nested;
    try {
      const hgc = makeFakeHgc({ view: null });
      const res = await reportBugResult({ description: 'mkdir test' }, hgc);
      const stat = await fs.stat(res.path);
      expect(stat.isFile()).toBe(true);
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('文件名格式 YYYYMMDDTHHMMSS-<6位>.json', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const hgc = makeFakeHgc({ view: null });
      const res = await reportBugResult({ description: 'name test' }, hgc);
      expect(path.basename(res.path)).toMatch(/^\d{8}T\d{6}-[A-Za-z0-9]{6}\.json$/);
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('description 缺失或空抛错', async () => {
    const hgc = makeFakeHgc({ view: null });
    await expect(reportBugResult({ description: '' }, hgc)).rejects.toThrow();
    await expect(reportBugResult({ description: '   ' }, hgc)).rejects.toThrow();
  });

  it('expected/actual 缺失时落盘为 null', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const hgc = makeFakeHgc({ view: null });
      const res = await reportBugResult({ description: 'no expected' }, hgc);
      const content = JSON.parse(await fs.readFile(res.path, 'utf8'));
      expect(content.expected).toBeNull();
      expect(content.actual).toBeNull();
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolveFeedbackDir 默认 data/ai-feedback,环境变量覆盖', () => {
    delete process.env.SGS_FEEDBACK_DIR;
    expect(resolveFeedbackDir()).toBe('data/ai-feedback');
    process.env.SGS_FEEDBACK_DIR = '/tmp/custom-fb';
    expect(resolveFeedbackDir()).toBe('/tmp/custom-fb');
    delete process.env.SGS_FEEDBACK_DIR;
  });
});
