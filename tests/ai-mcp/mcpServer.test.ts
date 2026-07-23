// tests/ai-mcp/mcpServer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  handleMcpRequest,
  PLAY_TOOL,
  CREATE_ROOM_TOOL,
  JOIN_ROOM_TOOL,
  SPECTATE_ROOM_TOOL,
  GET_SNAPSHOT_TOOL,
  SKILL_INFO_TOOL,
  REPORT_BUG_TOOL,
  type McpHandlerContext,
  type CreateRoomOpts,
  type JoinRoomOpts,
  type SpectateRoomOpts,
} from '../../src/ai-mcp/mcpServer';
import '../../src/engine/skills';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import {
  reportBugResult,
  resolveFeedbackDir,
} from '../../src/ai-mcp/feedbackHandler';

function makeFakeHgc(overrides: Partial<HeadlessGameClient> = {}): HeadlessGameClient {
  return {
    isSpectator: false,
    phase: 'playing',
    seatIndex: 0,
    playerId: 'p1',
    roomId: 'ROOM1',
    roomState: { hostId: 'p1', readyPlayers: ['p1'], playerIds: ['p1'], maxPlayers: 2, config: { name: 'r', timeoutScale: 1, charPool: 'all', handSize: 4, chat: { enabled: true, whitelistOnly: false, whitelist: [], maxPerGame: 0, maxPerMinute: 5, maxChars: 30 } }, spectatorIds: [], viewGrants: {}, pendingViewRequests: {} },
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

function makeCtx(
  hgc: HeadlessGameClient,
  handlers: Partial<{
    doCreateRoom: (o: CreateRoomOpts) => Promise<void>;
    doJoinRoom: (o: JoinRoomOpts) => Promise<void>;
    doSpectateRoom: (o: SpectateRoomOpts) => Promise<void>;
    advanceLobby: () => Promise<void>;
    isStarted: () => boolean;
  }> = {},
): McpHandlerContext {
  return {
    hgc,
    doCreateRoom: handlers.doCreateRoom ?? (vi.fn(async () => {}) as never),
    doJoinRoom: handlers.doJoinRoom ?? (vi.fn(async () => {}) as never),
    doSpectateRoom: handlers.doSpectateRoom ?? (vi.fn(async () => {}) as never),
    advanceLobby: handlers.advanceLobby ?? vi.fn(async () => {}),
    isStarted: handlers.isStarted ?? (() => true),
    seat: 0,
    playState: { lastView: null },
  };
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

  it('tools/list 返回全部 7 个工具', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
    const tools = (res!.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'play',
      'createRoom',
      'joinRoom',
      'spectateRoom',
      'getSnapshot',
      'getSkillInfo',
      'reportBug',
    ]);
    expect(SKILL_INFO_TOOL.inputSchema).toBeDefined();
    expect(REPORT_BUG_TOOL.inputSchema).toBeDefined();
    expect(GET_SNAPSHOT_TOOL.inputSchema).toBeDefined();
    expect(CREATE_ROOM_TOOL.inputSchema).toBeDefined();
    expect(JOIN_ROOM_TOOL.inputSchema).toBeDefined();
    expect(SPECTATE_ROOM_TOOL.inputSchema).toBeDefined();
  });

  it('JOIN_ROOM_TOOL schema 中 roomId 为 required', () => {
    expect((JOIN_ROOM_TOOL.inputSchema as { required?: string[] }).required).toEqual(['roomId']);
  });

  it('SPECTATE_ROOM_TOOL schema 中 roomId 为 required', () => {
    expect((SPECTATE_ROOM_TOOL.inputSchema as { required?: string[] }).required).toEqual(['roomId']);
  });

  it('CREATE_ROOM_TOOL schema 无 required（roomId 不必填）', () => {
    expect((CREATE_ROOM_TOOL.inputSchema as { required?: string[] }).required).toBeUndefined();
  });

  it('PLAY_TOOL schema 不再含 startGame 字段', () => {
    const props = (PLAY_TOOL.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).not.toHaveProperty('startGame');
    expect(props).toHaveProperty('action');
    expect(props).toHaveProperty('waitTimeoutMs');
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

  it('tools/call play 未启动时返回 -32602 引导用启动工具', async () => {
    const ctx = makeCtx(makeFakeHgc(), { isStarted: () => false });
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'play', arguments: {} } },
      ctx,
    );
    expect(res!.error).toBeDefined();
    expect(res!.error!.code).toBe(-32602);
    expect(res!.error!.message).toMatch(/createRoom|joinRoom|spectateRoom/);
  });

  it('tools/call createRoom 调用 ctx.doCreateRoom 并返回 host 结果', async () => {
    const doCreateRoom = vi.fn(async () => {});
    const hgc = makeFakeHgc(); // hostId === playerId → isHost true
    const ctx = makeCtx(hgc, { doCreateRoom });
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'createRoom', arguments: { name: '测试房', maxPlayers: 4, timeoutScale: 5 } },
      },
      ctx,
    );
    expect(doCreateRoom).toHaveBeenCalledWith({
      name: '测试房',
      maxPlayers: 4,
      playerId: undefined,
      timeoutScale: 5,
    });
    const sc = (res!.result as { structuredContent: { joinedAs: string; isHost: boolean; roomId: string } })
      .structuredContent;
    expect(sc.joinedAs).toBe('host');
    expect(sc.isHost).toBe(true);
    expect(sc.roomId).toBe('ROOM1');
  });

  it('tools/call joinRoom 把 roomId 传给 ctx.doJoinRoom，返回 guest 结果', async () => {
    const doJoinRoom = vi.fn(async () => {});
    // hostId 与 playerId 不同 → guest
    const hgc = makeFakeHgc({
      playerId: 'p2',
      roomState: { ...makeFakeHgc().roomState!, hostId: 'someone-else' } as never,
    });
    const ctx = makeCtx(hgc, { doJoinRoom });
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'joinRoom', arguments: { roomId: 'ABC123', playerId: 'ai-1' } },
      },
      ctx,
    );
    expect(doJoinRoom).toHaveBeenCalledWith({ roomId: 'ABC123', playerId: 'ai-1', timeoutScale: undefined });
    const sc = (res!.result as { structuredContent: { joinedAs: string; isHost: boolean } }).structuredContent;
    expect(sc.joinedAs).toBe('guest');
    expect(sc.isHost).toBe(false);
  });

  it('tools/call joinRoom 缺 roomId 返回 -32602 且错误信息引导改用 createRoom', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: { name: 'joinRoom', arguments: {} },
      },
      ctx,
    );
    expect(res!.error).toBeDefined();
    expect(res!.error!.code).toBe(-32603);
    expect(res!.error!.message).toContain('roomId');
    expect(res!.error!.message).toContain('createRoom');
  });

  it('tools/call spectateRoom 调用 ctx.doSpectateRoom 并返回 spectator 结果', async () => {
    const doSpectateRoom = vi.fn(async () => {});
    const hgc = makeFakeHgc({ isSpectator: true });
    const ctx = makeCtx(hgc, { doSpectateRoom });
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: { name: 'spectateRoom', arguments: { roomId: 'SP1' } },
      },
      ctx,
    );
    expect(doSpectateRoom).toHaveBeenCalledWith({ roomId: 'SP1', playerId: undefined });
    const sc = (res!.result as { structuredContent: { joinedAs: string; isHost: boolean } }).structuredContent;
    expect(sc.joinedAs).toBe('spectator');
    expect(sc.isHost).toBe(false);
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
    // 杀已迁移为 CardEffect（非技能模块），description 可能为 null
    expect(sc.skills[1].name).toBe('制衡');
    expect(sc.skills[1].description).toBeTypeOf('string');
    expect(sc.skills[1].description!.length).toBeGreaterThan(0);
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

  it('未知工具返回 -32601', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } },
      ctx,
    );
    expect(res!.error).toBeDefined();
    expect(res!.error!.code).toBe(-32601);
  });

  it('tools/call getSnapshot 返回完整视图', async () => {
    const stubView = {
      viewer: 0,
      currentPlayerIndex: 0,
      phase: 'play',
      turn: { round: 1, phase: 'play', vars: {} },
      players: [
        { index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4, alive: true, handCount: 4, hand: [], equipment: {}, skills: ['仁德'], marks: [], identity: '主公' },
      ],
      pending: null,
      deadline: null,
      deadlineTotalMs: 0,
      cardMap: {},
      settlementStack: [],
      log: [],
      zones: { deckCount: 120, discardPileCount: 0, processing: [] },
    } as unknown as Parameters<typeof import('../../src/ai-mcp/viewProjector').projectView>[0];
    const ctx = makeCtx(makeFakeHgc({ view: stubView }));
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'getSnapshot', arguments: {} } },
      ctx,
    );
    const result = res!.result as {
      content: { text: string }[];
      structuredContent: { view: { viewer: number; players: unknown[] } | null };
    };
    expect(result.structuredContent.view).not.toBeNull();
    expect(result.structuredContent.view!.viewer).toBe(0);
    expect(result.structuredContent.view!.players).toHaveLength(1);
    expect(result.content[0].text).toContain('刘备');
  });

  it('tools/call getSnapshot 在 view 为 null 时返回 { view: null }', async () => {
    const ctx = makeCtx(makeFakeHgc({ view: null }));
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'getSnapshot', arguments: {} } },
      ctx,
    );
    const result = res!.result as { structuredContent: { view: null } };
    expect(result.structuredContent.view).toBeNull();
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
