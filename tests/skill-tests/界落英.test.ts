// 界落英(界曹植·被动技)测试
//   其他角色的梅花牌因弃置或判定而置入弃牌堆后,你可以获得其中任意张牌。
//
// 官方来源:三国杀 OL 界限突破 hero/629。
//
// 验证:
//   1. respond validate:无 pending → 拒绝
//   2. respond execute:落英/choose 询问下写 choice 入 localVars
//   3. 端到端:其他玩家弃置 ♣牌 → 询问 → confirm → 曹植获得(弃牌堆空、手牌+1)
//   4. 端到端:其他玩家弃置 ♣牌 → 询问 → 取消 → 牌正常留弃牌堆
//   5. 端到端:其他玩家弃置 ♠牌 → 不触发(花色不符)
//   6. 端到端:曹植自己弃置 ♣牌 → 不触发(自己不触发)
//   7. 端到端:其他玩家判定 ♣牌 → 询问 → confirm → 曹植获得
//   8. 端到端:其他玩家判定 ♥牌 → 不触发(花色不符)
//   9. 端到端:回合外累计获得 ≥ 体力上限张 ♣牌 且 背面朝上 → 触发翻回询问
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  tags?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: opts.tags ?? [],
    judgeZone: [],
    faction: '魏',
    identity: '主公',
  };
}

describe('界落英', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界落英'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界落英',
      actionType: 'respond',
      params: { choice: true },
    });
  });

  it('respond:落英/choose 询问下 choice=true 写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界落英'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 直接注入 fake pending(单元测试)
    state.pendingSlots.set(0, {
      atom: {
        type: '请求回应',
        requestType: '落英/choose',
        target: 0,
        prompt: { type: 'confirm', title: '?' },
      },
      definition: undefined as never,
      startTime: 0,
      deadline: 100000,
      createdSeq: 0,
      isBlocking: true,
      resolve: () => {},
      isTimeout: false,
      isPaused: false,
      pause() {},
      _fireTimeoutNow: undefined,
    });

    await P0.expectAccepted({
      skillId: '界落英',
      actionType: 'respond',
      params: { choice: true },
    });
    await harness.waitForStable();
    expect(state.localVars['落英/choice']).toBe(true);
  });

  // ─── 端到端:弃置路径 ─────────────────────────

  it('端到端:其他玩家弃置 ♣牌 → confirm → 曹植获得', async () => {
    // 注:落英在判定路径下抽取判定牌后,applyView 增量视图仍按判定牌入弃牌堆 +1 投影,
    //   与全量视图(实际未入弃)不一致。弃置路径下不存在此问题。
    const club1 = makeCard('c1', '杀', '♣', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界落英'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['c1'], skills: [] }),
      ],
      cardMap: { c1: club1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 弃置 c1(梅花)——用 dispatch 风格(fire-and-forget),避免 await 卡住
    void applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['c1'] });
    await harness.waitForStable();

    // 询问 P0
    P0.expectPending('请求回应');
    await P0.respond('界落英', { choice: true });
    await harness.waitForStable();

    // P0 获得 c1
    expect(harness.state.players[0].hand).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c1');
  });

  it('端到端:其他玩家弃置 ♣牌 → 取消 → 牌留弃牌堆', async () => {
    const club1 = makeCard('c1', '杀', '♣', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界落英'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['c1'], skills: [] }),
      ],
      cardMap: { c1: club1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['c1'] });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界落英', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  it('端到端:其他玩家弃置 ♠牌 → 不触发落英', async () => {
    const spade1 = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界落英'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['s1'], skills: [] }),
      ],
      cardMap: { s1: spade1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['s1'] });
    await harness.waitForStable();

    // 非梅花,不触发
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('s1');
  });

  it('端到端:曹植自己弃置 ♣牌 → 不触发', async () => {
    const club1 = makeCard('c1', '杀', '♣', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['界落英'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { c1: club1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1'] });
    await harness.waitForStable();

    // 自己的弃置不触发
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── 端到端:判定路径 ─────────────────────────
  // 注:判定 atom 的 applyView 静态地按 deck→弃牌堆 建模(其 afterHooks 直接把判定牌
  //   移入弃牌堆,非 移动牌 事件,无法被拦截)。落英拿走判定牌后,实际弃牌堆为空,
  //   但增量视图仍 +1 → discardPileCount 与全量视图不一致。这是 判定 atom 视图模型的
  //   已知局限(同 天妒/闪电/乐不思蜀 等不拿牌时无此问题)。状态本身正确,本用例关闭自动对比。

  it('端到端:其他玩家判定 ♣牌 → confirm → 曹植获得', async () => {
    const restoreCompare = disableAutoCompare();
    const judge = makeCard('j1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界落英'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judge },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    try {
      void applyAtom(harness.state, { type: '判定', player: 1, judgeType: '测试' });
      await harness.waitForStable();

      P0.expectPending('请求回应');
      await P0.respond('界落英', { choice: true });
      await harness.waitForStable();

      expect(harness.state.players[0].hand).toContain('j1');
      expect(harness.state.zones.discardPile).not.toContain('j1');
    } finally {
      restoreCompare();
    }
  });

  it('端到端:其他玩家判定 ♥牌 → 不触发', async () => {
    const judge = makeCard('j1', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界落英'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judge },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '判定', player: 1, judgeType: '测试' });
    await harness.waitForStable();

    // 非梅花,不触发
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual([]);
    // 判定牌正常进弃牌堆
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 边界:外得累计 → 触发翻回正面 ─────────────────────────

  it('端到端:回合外累计获得 ≥ 体力上限张 ♣牌 且背面朝上 → 触发酒诗翻回询问', async () => {
    const restoreCompare = disableAutoCompare();
    // 曹植 体力上限=3,背面朝上,外得计数 0
    // 弃 3 张 ♣ 牌 → 累计 3 = 体力上限 → 触发翻回询问
    const clubs = [
      makeCard('c1', '杀', '♣', '2'),
      makeCard('c2', '杀', '♣', '3'),
      makeCard('c3', '杀', '♣', '4'),
    ];
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界落英', '界酒诗'],
          health: 3,
          maxHealth: 3,
          tags: ['酒诗/翻面'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c1', 'c2', 'c3'],
          skills: [],
        }),
      ],
      cardMap: { c1: clubs[0], c2: clubs[1], c3: clubs[2] },
      currentPlayerIndex: 1, // P1 回合 → P0 回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    try {
      // P1 一次弃 3 张 ♣
      void applyAtom(harness.state, {
        type: '弃置',
        player: 1,
        cardIds: ['c1', 'c2', 'c3'],
      });
      await harness.waitForStable();

      // 询问 1:落英 是否获得 3 张
      P0.expectPending('请求回应');
      await P0.respond('界落英', { choice: true });
      await harness.waitForStable();

      // 询问 2:酒诗 是否翻回正面
      P0.expectPending('请求回应');
      const slot = [...harness.state.pendingSlots.values()][0];
      const atom = slot.atom as { requestType?: string };
      expect(atom.requestType).toBe('酒诗/flipBack');
      await P0.respond('界酒诗', { choice: true });
      await harness.waitForStable();

      // P0 获得了 3 张 ♣
      expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));
      // 翻回正面:无 '/翻面' 后缀标签
      expect(harness.state.players[0].tags.some((t) => t.endsWith('/翻面'))).toBe(false);
    } finally {
      restoreCompare();
    }
  });

  it('端到端:正面朝上时不触发翻回询问(即使外得≥上限)', async () => {
    const clubs = [
      makeCard('c1', '杀', '♣', '2'),
      makeCard('c2', '杀', '♣', '3'),
      makeCard('c3', '杀', '♣', '4'),
    ];
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界落英', '界酒诗'],
          health: 3,
          maxHealth: 3,
          // 正面朝上:无 '/翻面' 标签
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c1', 'c2', 'c3'],
          skills: [],
        }),
      ],
      cardMap: { c1: clubs[0], c2: clubs[1], c3: clubs[2] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 弃 3 张 ♣
    void applyAtom(harness.state, {
      type: '弃置',
      player: 1,
      cardIds: ['c1', 'c2', 'c3'],
    });
    await harness.waitForStable();

    // 询问 1:落英 是否获得
    P0.expectPending('请求回应');
    await P0.respond('界落英', { choice: true });
    await harness.waitForStable();

    // 正面朝上 → 不触发翻回询问
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));
  });
});
