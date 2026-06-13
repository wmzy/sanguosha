// tests/integration/restore-from-log.test.ts
// e2e 覆盖:saveRoom + loadRoom + restoreFromLog 往返一致
// 用新的 create + bootstrap 顶层 API 建 state,经 dispatch 几步后保存,再 restore 验证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'restore-from-log-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadPersistence() {
  return import('../../src/server/persistence');
}

const CHARACTERS = [
  { name: '刘备', skills: ['仁德'] },
  { name: '曹操', skills: ['护甲'] },
  { name: '孙权', skills: ['制衡'] },
];

const META = { roomName: 'test-room', maxPlayers: 3, hostId: null, debug: false };

async function makeGame(seed = 42): Promise<{ state: import('../../src/engine/types').GameState; characters: typeof CHARACTERS }> {
  const { create, bootstrap, resetForTest } = await import('../../src/engine/create-engine');
  resetForTest();
  const config = { characters: CHARACTERS, playerCount: 3, seed, gameId: 'test' };
  const state = create(config);
  await bootstrap(state);
  return { state, characters: CHARACTERS };
}

describe('restoreFromLog — 持久化 + 恢复 e2e', () => {
  it('saveRoom + loadRoom + restoreFromLog 还原到完全相同的 state', async () => {
    const { saveRoom, loadRoom, restoreFromLog } = await loadPersistence();
    const { state } = await makeGame();

    await saveRoom('room-restore', META, state, state.actionLog, true);
    const persisted = (await loadRoom('room-restore'))!;
    const restored = restoreFromLog(persisted);

    // 关键字段一致(seed / players / seq)
    expect(restored.rngSeed).toBe(state.rngSeed);
    expect(restored.players).toHaveLength(state.players.length);
    expect(restored.seq).toBe(state.seq);
    // 每个玩家手牌数 / 武将 / 身份一致
    for (let i = 0; i < state.players.length; i++) {
      expect(restored.players[i].name).toBe(state.players[i].name);
      expect(restored.players[i].character).toBe(state.players[i].character);
      expect(restored.players[i].vars['身份']).toBe(state.players[i].vars['身份']);
      expect(restored.players[i].hand).toEqual(state.players[i].hand);
    }
  });

  it('saveRoom 把 actionLog 全量保存;loadRoom 读回后可用于诊断', async () => {
    const { saveRoom, loadRoom } = await loadPersistence();
    const { state } = await makeGame();

    // 制造一点 action:回合管理 end
    const { dispatch } = await import('../../src/engine/create-engine');
    await dispatch(state, {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: state.players[0].name,
      params: {},
      baseSeq: 0,
    });

    await saveRoom('room-log', META, state, state.actionLog, true);
    const persisted = (await loadRoom('room-log'))!;
    // actionLog 应该至少含 2 条:开局 start + 回合管理 end
    expect(persisted.actionLog.length).toBeGreaterThanOrEqual(2);
    expect(persisted.actionLog[persisted.actionLog.length - 1].message.skillId).toBe('回合管理');
  });

  it('session.restoreState 拿 restoreFromLog 的输出接管,玩家名映射正常', async () => {
    const { saveRoom, loadRoom, restoreFromLog } = await loadPersistence();
    const { state } = await makeGame();
    await saveRoom('room-session', META, state, state.actionLog, true);
    const persisted = (await loadRoom('room-session'))!;
    const restored = restoreFromLog(persisted);

    // 模拟 session.restoreState 的核心断言:state 存在 + players 有合理数据
    expect(restored).toBeTruthy();
    expect(restored.players.length).toBe(3);
    // 至少有一个玩家被识别为 主公
    expect(restored.players.some(p => p.vars['身份'] === '主公')).toBe(true);
  });
});
