// tests/skill-tests/界徐晃.test.ts
// 界徐晃(魏·界限突破)测试:OL 现行界版
//
// 界断粮(主动技/转化):
//   你可以将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用。
//   若你本回合未造成过伤害,你使用【兵粮寸断】无距离限制。
//
// 截辎(触发技):
//   当一名角色跳过摸牌阶段后,你可以选择一名角色,若其手牌数全场最少且没有"辎",
//   其获得"辎"标记,否则其摸一张牌。有"辎"的角色于其摸牌阶段结束时移除"辎",
//   然后执行一个额外的摸牌阶段。
//
// 与标版差异(测试覆盖):
//   - 界断粮距离规则:标版"目标手牌数≥自己则无限制";界版"本回合未造成过伤害则无限制"
//   - 截辎:标版"他人跳摸牌后徐晃摸1张";界版完整辎标记系统 + 额外摸牌阶段
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable, disableAutoCompare } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json, Mark, PlayerState } from '../../src/engine/types';

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
  marks?: Mark[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界徐晃',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['回合管理'],
    vars: {},
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: opts.tags ?? [],
    judgeZone: [],
    faction: '魏',
    identity: '主公',
  };
}

// ─── 界断粮 ────────────────────────────────────────────────────
describe('界断粮', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 黑色基本牌 → 放置兵粮寸断(距离1内,本回合未造成伤害)───
  it('黑色基本牌当兵粮寸断 → 放置到距离1的目标', async () => {
    const kill = makeCard('c1', '杀', '♠', '7'); // 黑色基本牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['界断粮', '回合管理'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'] }),
      ],
      cardMap: { c1: kill, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.triggerAction('界断粮', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);

    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('兵粮寸断');
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c1');
  });

  // ─── 2. 黑色装备牌 → 放置兵粮寸断 ──────────────────────────
  it('黑色装备牌当兵粮寸断', async () => {
    const equip = makeCard('c1', '寒冰剑', '♠', '2', '装备牌'); // 黑色装备牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['界断粮', '回合管理'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'] }),
      ],
      cardMap: { c1: equip, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.triggerAction('界断粮', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);

    expect(harness.state.players[1].pendingTricks[0].name).toBe('兵粮寸断');
  });

  // ─── 3. 本回合未造成过伤害 → 无距离限制(3人局,距离2) ────────
  it('本回合未造成过伤害 → 距离2也合法(无距离限制)', async () => {
    const kill = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['界断粮', '回合管理'] }),
        makePlayer({ index: 1, name: '中间', hand: [] }),
        makePlayer({ index: 2, name: '远目标', hand: ['d1'] }),
      ],
      cardMap: {
        c1: kill,
        d1: makeCard('d1', '闪', '♥', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.triggerAction('界断粮', 'use', { cardId: 'c1', target: 2 });
    await waitForStable(harness.state);

    expect(harness.state.players[2].pendingTricks.length).toBe(1);
    expect(harness.state.players[2].pendingTricks[0].name).toBe('兵粮寸断');
  });

  // ─── 4. 本回合造成过伤害 + 距离>1 → 拒绝 ────────────────────
  it('本回合造成过伤害 + 距离>1 → 拒绝', async () => {
    const kill = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['界断粮', '回合管理'] }),
        makePlayer({ index: 1, name: '中间', hand: [] }),
        makePlayer({ index: 2, name: '远目标', hand: [] }),
        makePlayer({ index: 3, name: '中间B', hand: [] }),
      ],
      cardMap: { c1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    // 手动模拟"本回合造成过伤害":直接 applyAtom 一个来源为 0 的伤害 atom
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
    });
    await waitForStable(harness.state);

    await P0.expectRejected({
      skillId: '界断粮',
      actionType: 'use',
      params: { cardId: 'c1', target: 2 },
    });
  });

  // ─── 5. 本回合造成过伤害 + 距离1 → 仍合法 ────────────────────
  it('本回合造成过伤害 + 距离1 → 仍合法', async () => {
    const kill = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['界断粮', '回合管理'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'] }),
      ],
      cardMap: { c1: kill, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
    });
    await waitForStable(harness.state);

    await P0.triggerAction('界断粮', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);

    expect(harness.state.players[1].pendingTricks[0].name).toBe('兵粮寸断');
  });

  // ─── 6. 红色基本牌 → 拒绝(非黑色)──────────────────────────────
  it('红色基本牌 → 拒绝', async () => {
    const red = makeCard('c1', '杀', '♥', '7'); // 红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['界断粮', '回合管理'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'] }),
      ],
      cardMap: { c1: red, d1: makeCard('d1', '闪', '♠', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.expectRejected({
      skillId: '界断粮',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 7. 黑色锦囊牌 → 拒绝(非基本/装备)──────────────────────────
  it('黑色锦囊牌 → 拒绝(只接受基本/装备)', async () => {
    const trick = makeCard('c1', '过河拆桥', '♠', '3', '锦囊牌'); // 黑色但锦囊
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['界断粮', '回合管理'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'] }),
      ],
      cardMap: { c1: trick, d1: makeCard('d1', '闪', '♠', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.expectRejected({
      skillId: '界断粮',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 8. 对自己 → 拒绝 ───────────────────────────────────
  it('对自己使用 → 拒绝', async () => {
    const kill = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['界断粮', '回合管理'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'] }),
      ],
      cardMap: { c1: kill, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.expectRejected({
      skillId: '界断粮',
      actionType: 'use',
      params: { cardId: 'c1', target: 0 },
    });
  });
});

// ─── 截辎 ────────────────────────────────────────────────────
describe('截辎', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 跳过摸牌 + 发动 + 目标手牌最少且无辎 → 加"辎" ──────────
  it('发动 + 目标手牌全场最少且无辎 → 加"辎"标记', async () => {
    // 关闭自动对比:skipPhase 期间 state.phase(判定)与 view.phase(摸牌)存在
    // 已知不对称(阶段结束.applyView 设 view.phase,apply 不设 state.phase)。
    const restoreAutoCompare = disableAutoCompare();
    try {
      const state: GameState = createGameState({
      players: [
        // 徐晃:5 张手牌(最多)
        makePlayer({
          index: 0,
          name: '徐晃',
          hand: ['a1', 'a2', 'a3', 'a4', 'a5'],
          skills: ['截辎', '回合管理'],
        }),
        // 目标:1 张手牌(全场最少),被兵粮寸断跳过摸牌
        makePlayer({
          index: 1,
          name: '目标',
          hand: ['b1'],
          skills: ['兵粮寸断', '回合管理'],
          tags: ['兵粮寸断/跳过摸牌'],
        }),
      ],
      cardMap: {
        a1: makeCard('a1', '杀', '♠'),
        a2: makeCard('a2', '杀', '♠'),
        a3: makeCard('a3', '杀', '♠'),
        a4: makeCard('a4', '杀', '♠'),
        a5: makeCard('a5', '杀', '♠'),
        b1: makeCard('b1', '杀', '♠'),
        d1: makeCard('d1', '杀', '♠'),
        d2: makeCard('d2', '杀', '♠'),
      },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    // 判定阶段结束 → 回合管理推进:阶段开始(摸牌)[被兵粮寸断 cancel+skipPhase]
    // → 阶段结束(摸牌) → 截辎触发
    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    P0.expectPending('请求回应');

    // 发动 截辎
    await P0.triggerAction('截辎', 'respond', { choice: true });
    await waitForStable(harness.state);
    P0.expectPending('请求回应');

    // 选自己(徐晃)作为目标——徐晃 5 张手牌最多,不符合"全场最少" → 应摸1张
    // 改为选 P1(目标),P1 跳过摸牌后手牌仍是 1(全场最少)→ 加"辎"
    await P0.triggerAction('截辎', 'respond', { targets: [1] });
    await waitForStable(harness.state);

    // P1 获得"辎"标记
      expect(harness.state.players[1].marks.some((m) => m.id === '辎')).toBe(true);
    } finally {
      restoreAutoCompare();
    }
  });

  // ─── 2. 跳过摸牌 + 发动 + 目标非最少 → 目标摸1张 ──────────
  it('发动 + 目标手牌非全场最少 → 目标摸一张牌', async () => {
    const restoreAutoCompare = disableAutoCompare();
    try {
      const state: GameState = createGameState({
      players: [
        // 徐晃:1 张(最少,但选徐晃也能验证"否则摸1张")
        makePlayer({
          index: 0,
          name: '徐晃',
          hand: ['a1'],
          skills: ['截辎', '回合管理'],
        }),
        // 中间:5 张(最多)
        makePlayer({
          index: 1,
          name: '中间',
          hand: ['b1', 'b2', 'b3', 'b4', 'b5'],
          skills: ['兵粮寸断', '回合管理'],
          tags: ['兵粮寸断/跳过摸牌'],
        }),
      ],
      cardMap: {
        a1: makeCard('a1', '杀', '♠'),
        b1: makeCard('b1', '杀', '♠'),
        b2: makeCard('b2', '杀', '♠'),
        b3: makeCard('b3', '杀', '♠'),
        b4: makeCard('b4', '杀', '♠'),
        b5: makeCard('b5', '杀', '♠'),
        d1: makeCard('d1', '杀', '♠'),
      },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    P0.expectPending('请求回应');

    // 发动 截辎
    await P0.triggerAction('截辎', 'respond', { choice: true });
    await waitForStable(harness.state);
    P0.expectPending('请求回应');

    // 选 P1(5 张,全场最多,非最少)→ 摸 1 张
    const handBefore = harness.state.players[1].hand.length;
    await P0.triggerAction('截辎', 'respond', { targets: [1] });
    await waitForStable(harness.state);

    expect(harness.state.players[1].hand.length).toBe(handBefore + 1);
      expect(harness.state.players[1].marks.some((m) => m.id === '辎')).toBe(false);
    } finally {
      restoreAutoCompare();
    }
  });

  // ─── 3. 跳过摸牌 + 不发动 → 无效果 ──────────────────────
  it('不发动 截辎 → 无效果', async () => {
    const restoreAutoCompare = disableAutoCompare();
    try {
      const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '徐晃',
          hand: ['a1'],
          skills: ['截辎', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: '目标',
          hand: [],
          skills: ['兵粮寸断', '回合管理'],
          tags: ['兵粮寸断/跳过摸牌'],
        }),
      ],
      cardMap: { a1: makeCard('a1', '杀', '♠') },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    P0.expectPending('请求回应');

    // 不发动
    await P0.triggerAction('截辎', 'respond', { choice: false });
    await waitForStable(harness.state);

    expect(harness.state.players[1].marks.length).toBe(0);
    } finally {
      restoreAutoCompare();
    }
  });

  // ─── 4. 有"辎"的角色摸牌阶段结束 → 移除"辎" + 额外摸牌阶段 ──
  it('有"辎"的角色摸牌阶段结束 → 移除"辎" + 额外摸2张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '徐晃',
          hand: ['a1'],
          skills: ['截辎', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: '有辎者',
          hand: [],
          skills: ['回合管理'],
          marks: [{ id: '辎', scope: 1 }],
        }),
      ],
      cardMap: {
        a1: makeCard('a1', '杀', '♠'),
        d1: makeCard('d1', '杀', '♠'),
        d2: makeCard('d2', '杀', '♠'),
        d3: makeCard('d3', '杀', '♠'),
        d4: makeCard('d4', '杀', '♠'),
      },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = {
      deck: ['d1', 'd2', 'd3', 'd4'],
      discardPile: [],
      processing: [],
    };
    await harness.setup(state);

    // 判定阶段结束 → 回合管理推进:摸牌(摸2) → 阶段结束(摸牌)
    // → 截辎检测"辎" → 移除 + 额外摸牌阶段(摸2)
    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });
    await waitForStable(harness.state);

    // P1 摸了 4 张(2正常 + 2额外)
    expect(harness.state.players[1].hand.length).toBe(4);
    // "辎"标记被移除
    expect(harness.state.players[1].marks.some((m) => m.id === '辎')).toBe(false);
    // 推进到出牌阶段
    expect(harness.state.phase).toBe('出牌');
  });

  // ─── 5. 无"辎"的正常摸牌阶段 → 不触发额外摸牌 ──────────
  it('无"辎"的正常摸牌阶段 → 仅摸2张,无额外', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '徐晃',
          hand: [],
          skills: ['截辎', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: '无辎者',
          hand: [],
          skills: ['回合管理'],
        }),
      ],
      cardMap: {
        d1: makeCard('d1', '杀', '♠'),
        d2: makeCard('d2', '杀', '♠'),
        d3: makeCard('d3', '杀', '♠'),
      },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });
    await waitForStable(harness.state);

    // 仅摸 2 张(默认),无额外
    expect(harness.state.players[1].hand.length).toBe(2);
  });
});
