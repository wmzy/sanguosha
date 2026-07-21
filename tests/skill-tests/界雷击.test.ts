// 界雷击(界张角·被动):使用/打出【闪】或使用【闪电】时可判定,
// 黑桃→可对一名角色造成2点雷电伤害;梅花→回复1点体力并可对一名角色造成1点雷电伤害。
//
// 覆盖:
//   1. 打闪→判定黑桃→选目标→2点雷电伤害(happy path)
//   2. 打闪→判定梅花→界张角回复1点体力+目标受1点雷电伤害
//   3. 打闪→放弃判定→无判定无伤害
//   4. 打闪→判定黑桃→放弃造伤→无伤害
//   5. 使用闪电→触发界雷击→判定黑桃→造伤(新增触发路径)
//   6. 未出闪→界雷击不触发
//   7. 打闪→判定非黑桃非梅花(♥)→无伤害无回血
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SkillTestHarness,
  waitForStable,
  disableAutoCompare,
} from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  faction?: '魏' | '蜀' | '吴' | '群';
  hand?: string[];
  skills?: string[];
  health?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    faction: opts.faction,
  };
}

describe('界雷击', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 打闪→判定黑桃→选目标→2点雷电伤害 ──────────────────────
  it('界张角打闪触发界雷击,判定黑桃→选择目标受2点雷电伤害', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // ♠5 黑桃 → 造伤
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: ['d1'],
          skills: ['界雷击', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');
    const P1 = harness.player('攻击者');

    // P1 对界张角出杀
    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state); // 界张角被询问闪
    P0.expectPending('询问闪');

    // 界张角出闪
    await P0.respond('闪', { cardId: 'd1' });
    await waitForStable(harness.state); // 界雷击触发:询问是否判定

    // 界雷击询问:是否判定(confirm)
    P0.expectPending('请求回应');
    await P0.respond('界雷击', { confirmed: true });
    await waitForStable(harness.state); // 判定完成 → 询问选目标

    // 界雷击询问:选择伤害目标
    P0.expectPending('请求回应');
    await P0.respond('界雷击', { target: 1 });
    await waitForStable(harness.state);

    // ♠5 黑桃 → P1 受 2 点雷电伤害(杀被闪抵消,界张角不掉血)
    expect(harness.state.players[1].health).toBe(2); // 4 - 2
    expect(harness.state.players[0].health).toBe(3); // 界张角未受伤(闪抵消杀)
  });

  // ─── 2. 打闪→判定梅花→界张角回复1点+目标受1点雷电伤害 ────────
  it('界张角打闪触发界雷击,判定梅花→界张角回复1点且目标受1点雷电伤害', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♣', '5'); // ♣5 梅花
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: ['d1'],
          skills: ['界雷击', '闪', '回合管理'],
          health: 2, // 不满血(可回血)
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].maxHealth = 3;
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');
    const P1 = harness.player('攻击者');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);
    await P0.respond('闪', { cardId: 'd1' });
    await waitForStable(harness.state);

    // 确认判定
    P0.expectPending('请求回应');
    await P0.respond('界雷击', { confirmed: true });
    await waitForStable(harness.state);

    // 选目标
    P0.expectPending('请求回应');
    await P0.respond('界雷击', { target: 1 });
    await waitForStable(harness.state);

    // ♣5 梅花 → 界张角回复1点(2→3),P1 受1点雷电伤害(4→3)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 3. 打闪→放弃判定→无判定无伤害 ──────────────────────────
  it('界张角选择不判定(pass)→无判定无伤害', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: ['d1'],
          skills: ['界雷击', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');
    const P1 = harness.player('攻击者');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);
    await P0.respond('闪', { cardId: 'd1' });
    await waitForStable(harness.state);
    P0.expectPending('请求回应'); // 界雷击:是否判定

    // 放弃判定(confirmed=false)
    await P0.respond('界雷击', { confirmed: false });
    await waitForStable(harness.state);

    // 未判定 → 判定牌仍在牌堆顶
    expect(harness.state.zones.deck).toContain('j1');
    // 双方无雷击伤害(杀被闪抵消)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 4. 打闪→判定黑桃→放弃造伤→无伤害 ──────────────────────
  it('判定黑桃但放弃造伤(pass 选目标)→无伤害', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // ♠5 → 可造伤
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: ['d1'],
          skills: ['界雷击', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');
    const P1 = harness.player('攻击者');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);
    await P0.respond('闪', { cardId: 'd1' });
    await waitForStable(harness.state);

    // 确认判定
    await P0.respond('界雷击', { confirmed: true });
    await waitForStable(harness.state);

    // 放弃选目标(pass → target=undefined → 不造伤)
    P0.expectPending('请求回应');
    await P0.pass();
    await waitForStable(harness.state);

    // ♠5 判定但放弃造伤 → P1 不受伤
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 5. 使用闪电→触发界雷击→判定黑桃→造伤 ────────────────────
  it('界张角使用闪电触发界雷击,判定黑桃→目标受2点雷电伤害', async () => {
    const lightning = makeCard('lt1', '闪电', '♠', 'A', '锦囊牌');
    const judge = makeCard('j1', '杀', '♠', 'K'); // ♠K 黑桃(非2-9,闪电不命中但界雷击仅看花色)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: ['lt1'],
          skills: ['界雷击', '界鬼道', '闪电', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '目标',
          faction: '群',
          hand: [],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { lt1: lightning, j1: judge },
      currentPlayerIndex: 0, // 界张角回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');

    // 界张角使用闪电(use action)
    await P0.useCard('闪电', 'lt1');
    await waitForStable(harness.state); // 界雷击触发:询问是否判定

    // 界雷击询问:是否判定
    P0.expectPending('请求回应');
    await P0.respond('界雷击', { confirmed: true });
    await waitForStable(harness.state); // 判定完成 → 界鬼道可能询问(有黑色手牌?)

    // 界鬼道不会触发(闪电使用后界张角手牌为空,无黑色手牌)
    // 直接进入选目标(若有鬼道询问则先跳过)
    // 检查是否有鬼道询问(界张角无手牌 → 鬼道不询问)
    // 界雷击询问:选择伤害目标
    P0.expectPending('请求回应');
    await P0.respond('界雷击', { target: 1 });
    await waitForStable(harness.state);

    // ♠K 黑桃 → P1 受 2 点雷电伤害
    expect(harness.state.players[1].health).toBe(2); // 4 - 2
    expect(harness.state.players[0].health).toBe(3); // 界张角未受伤
    // 闪电已放置到界张角判定区
    expect(harness.state.players[0].pendingTricks.some((t) => t.name === '闪电')).toBe(true);
  });

  // ─── 6. 未出闪→界雷击不触发 ────────────────────────────────
  it('界张角被询问闪但未出闪(pass)→界雷击不触发', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: [], // 无闪
          skills: ['界雷击', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { k1: kill, j1: judge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');
    const P1 = harness.player('攻击者');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);
    P0.expectPending('询问闪');

    // 界张角不出闪
    await P0.pass();
    await waitForStable(harness.state);

    // 界雷击未触发:无后续 请求回应 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.zones.deck).toContain('j1');
    // 杀命中:界张角受 1 点伤害(无闪)
    expect(harness.state.players[0].health).toBe(2); // 3 - 1
    // 攻击者不受雷击伤害
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 7. 打闪→判定非黑桃非梅花(♥)→无伤害无回血 ────────────────
  it('判定结果非黑桃非梅花(♥5)→无伤害无回血', async () => {
    const dodge = makeCard('d1', '闪', '♠', '3');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♥', '5'); // ♥5 → 无效果
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: ['d1'],
          skills: ['界雷击', '闪', '回合管理'],
          health: 2, // 不满血(若回血可见)
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].maxHealth = 3;
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');
    const P1 = harness.player('攻击者');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);
    await P0.respond('闪', { cardId: 'd1' });
    await waitForStable(harness.state);

    // 确认判定
    P0.expectPending('请求回应');
    await P0.respond('界雷击', { confirmed: true });
    await waitForStable(harness.state);

    // ♥5 非黑桃非梅花 → 无后续选目标询问
    expect(harness.state.pendingSlots.size).toBe(0);
    // 双方无变化
    expect(harness.state.players[0].health).toBe(2); // 未回血
    expect(harness.state.players[1].health).toBe(4); // 未受伤
  });

  // ─── 8. 组合:打闪→界雷击→界鬼道改判为黑桃→命中 ────────────
  it('界张角打闪→界雷击→界鬼道把判定牌改为黑桃→命中2点雷电伤害', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♥', '5'); // ♥5 原本不命中
    const replace = makeCard('r1', '杀', '♠', '3'); // ♠3 黑色牌 → 界鬼道改判命中
    const drawCard = makeCard('dd1', '闪', '♥', '3'); // 界鬼道 ♠3 是黑桃2-9 → 摸牌(但需牌堆有牌)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: ['d1', 'r1'], // 闪 + 界鬼道替换牌
          skills: ['界雷击', '界鬼道', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge, r1: replace, dd1: drawCard },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 界鬼道替换判定牌(直接 mutate frameCards)→ processedView 与 buildView 不对称
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1', 'dd1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P0 = harness.player('界张角');
      const P1 = harness.player('攻击者');

      await P1.useCardAndTarget('杀', 'k1', [0]);
      await waitForStable(harness.state);
      await P0.respond('闪', { cardId: 'd1' });
      await waitForStable(harness.state);

      // 界雷击:确认判定
      P0.expectPending('请求回应');
      await P0.respond('界雷击', { confirmed: true });
      await waitForStable(harness.state);

      // 判定后 → 界鬼道询问是否替换
      P0.expectPending('请求回应');
      await P0.respond('界鬼道', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      // 界鬼道:♠3 是黑桃2-9 → 摸一张牌(dd1)
      expect(harness.state.players[0].hand).toContain('dd1');

      // 界雷击:选择伤害目标
      P0.expectPending('请求回应');
      await P0.respond('界雷击', { target: 1 });
      await waitForStable(harness.state);

      // 改判为 ♠3(黑桃)→ P1 受 2 点雷电伤害
      expect(harness.state.players[1].health).toBe(2); // 4 - 2
      // 替换牌消耗
      expect(harness.state.players[0].hand).not.toContain('r1');
    } finally {
      restoreCompare();
    }
  });
});
