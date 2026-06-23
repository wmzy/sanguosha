// 验证 buildView:选将期间 pending 隔离。
// 根因修复:buildView 曾用 findPendingSlot(含 size===1 fallback),主公选将期间(单 slot)
// 其他 viewer 错误匹配到主公 slot → 共用倒计时 + 渲染别人的选将界面。
// 修复后:buildView 只匹配 viewer 专属 slot 或广播型 slot(target===TARGET_BROADCAST)。
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest, bootstrap, dispatch, buildView } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import { allCharacters } from '../../src/engine/cards/characters';

const CHARACTERS = allCharacters.map(c => ({
  name: c.name, skills: c.skills.map(s => s.name),
}));

function makePlayer(index: number, name: string) {
  return {
    index, name, character: '', health: 4, maxHealth: 4, alive: true,
    hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [],
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('buildView:选将期间 pending 隔离', () => {
  let state: GameState;

  beforeEach(() => {
    resetForTest();
    state = createGameState({
      players: [
        makePlayer(0, 'P1'), makePlayer(1, 'P2'), makePlayer(2, 'P3'),
        makePlayer(3, 'P4'), makePlayer(4, 'P5'),
      ],
      cardMap: {},
    });
    for (let i = 0; i < 60; i++) {
      const id = `deck_${i}`;
      state.cardMap[id] = { id, name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
      state.zones.deck.push(id);
    }
  });

  it('主公选将期间(单 slot):主公有 pending,其他 viewer pending 为 null', async () => {
    void bootstrap(state, { characters: CHARACTERS, playerCount: 5, seed: 42, gameId: 'test' });
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);

    // 主公(viewer 0)应有选将 pending
    const lordView = buildView(state, 0);
    expect(lordView.pending).not.toBeNull();
    expect(lordView.pending!.atom?.type).toBe('选将询问');
    expect(lordView.pending!.target).toBe(0);
    expect(lordView.pending!.deadline).toBeGreaterThan(Date.now());
    expect(lordView.pending!.totalMs).toBe(60_000);

    // 其他玩家(viewer 1-4)pending 必须为 null —— 不能看到主公的选将/倒计时
    for (let v = 1; v < 5; v++) {
      const vView = buildView(state, v);
      expect(vView.pending).toBeNull();
    }
  }, 15000);

  it('并行选将期间(多 slot):每个选将 viewer 有自己的 pending,主公(已选)pending 为 null', async () => {
    void bootstrap(state, { characters: CHARACTERS, playerCount: 5, seed: 42, gameId: 'test' });
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);

    // 主公选完
    const lordSlot = state.pendingSlots.get(0)!;
    const lordCand = (lordSlot.atom as { candidates: Array<{ name: string }> }).candidates;
    void dispatch(state, {
      skillId: '系统规则', actionType: '选将', ownerId: 0,
      params: { character: lordCand[0].name }, baseSeq: 0,
    });
    for (let i = 0; i < 100 && state.pendingSlots.size !== 4; i++) await sleep(10);

    // 每个并行选将 viewer 应有自己的独立 pending
    for (let v = 1; v < 5; v++) {
      const vView = buildView(state, v);
      expect(vView.pending).not.toBeNull();
      expect(vView.pending!.atom?.type).toBe('选将询问');
      expect(vView.pending!.target).toBe(v);
      expect(vView.pending!.totalMs).toBe(60_000);
      expect(vView.pending!.deadline).toBeGreaterThan(Date.now() + 55_000);
    }

    // 主公(已选完)pending 应为 null
    const lordView = buildView(state, 0);
    expect(lordView.pending).toBeNull();
  }, 15000);
});
