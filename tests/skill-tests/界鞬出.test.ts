// 界鞬出(界庞德·群雄·被动技)测试:
//   1. 目标弃基本牌 → 获得此杀,杀不生效(不扣血)
//   2. 目标弃非基本牌(装备)→ 不能抵消此杀,强制命中 + 本回合出杀次数+1
//   3. 目标弃非基本牌(锦囊)→ 同 2(强制命中,且本回合可多出一次杀)
//   4. 庞德不发动 → 正常询问闪,目标出闪抵消
//   5. 目标无牌可弃 → 鞬出不触发,正常受伤
//   6. 他人出杀 → 鞬出不触发
//   7. 出杀次数+1 累计:连续两次非基本→上限=1+2=3(本回合共可出 3 杀)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { slashMax } from '../../src/engine/slash-quota';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, ...(subtype ? { subtype } : {}) };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界庞德',
    health: opts.health ?? 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界鞬出', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 弃基本牌 → 获得此杀,杀不生效,不扣血 ─────────────────────────────
  it('目标弃基本牌(手牌的闪)→ 获得此杀,杀不生效,不扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2'); // 闪 = 基本牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界庞德', hand: ['k1'], skills: ['杀', '界鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界庞德');
    const P2 = harness.player('P2');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    P0.expectPending('请求回应');
    await P0.respond('界鞬出', { choice: true });

    // 目标选弃基本牌(闪, handIndex 0)
    P2.expectPending('请求回应');
    await P2.respond('界鞬出', { zone: 'hand', handIndex: 0 });

    // 基本牌 → 此杀不生效,目标获得此杀,不扣血
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[1].hand).not.toContain('d1');
    expect(harness.state.zones.discardPile).toContain('d1');
    // 目标获得此杀
    expect(harness.state.players[1].hand).toContain('k1');
    expect(harness.state.zones.discardPile).not.toContain('k1');
    // 基本牌分支不加出杀次数
    expect(harness.state.turn.vars['界鞬出/quotaBonus']).toBeUndefined();
  });

  // ─── 弃非基本牌(装备)→ 不能抵消,强制命中,出杀次数+1 ─────────────────────
  it('目标弃装备牌(非基本)→ 不能抵消,强制命中扣血,本回合出杀次数+1', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const horse = makeCard('h1', '紫骍', '♥', '5', '装备牌', '进攻马');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界庞德', hand: ['k1'], skills: ['杀', '界鞬出'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          equipment: { 进攻马: 'h1' },
          skills: ['闪'],
        }),
      ],
      cardMap: { k1: kill, d1: dodge, h1: horse },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界庞德');
    const P2 = harness.player('P2');

    // 初始上限 = 1
    expect(slashMax(harness.state, 0)).toBe(1);

    await P0.useCardAndTarget('杀', 'k1', [1]);
    P0.expectPending('请求回应');
    await P0.respond('界鞬出', { choice: true });

    // 目标弃装备(非基本牌)
    P2.expectPending('请求回应');
    await P2.respond('界鞬出', { zone: 'equipment', cardId: 'h1' });

    // 非基本牌 → 禁闪,强制命中(询问闪被跳过)→ 扣血
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].equipment['进攻马']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('h1');
    // P2 有闪但禁闪未能使用,闪仍在手里
    expect(harness.state.players[1].hand).toContain('d1');
    // 杀结算后进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    // 出杀次数加成 = 1
    expect(harness.state.turn.vars['界鞬出/quotaBonus']).toBe(1);
    expect(slashMax(harness.state, 0)).toBe(2);
  });

  // ─── 弃非基本牌(锦囊)→ 强制命中 + 出杀次数+1 ─────────────────────
  it('目标弃锦囊牌(非基本)→ 不能抵消,强制命中,出杀次数+1', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const trick = makeCard('t1', '无中生有', '♥', '7', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界庞德', hand: ['k1'], skills: ['杀', '界鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['t1'], skills: [] }),
      ],
      cardMap: { k1: kill, t1: trick },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界庞德');
    const P2 = harness.player('P2');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    P0.expectPending('请求回应');
    await P0.respond('界鞬出', { choice: true });

    // 目标弃锦囊(非基本牌)
    P2.expectPending('请求回应');
    await P2.respond('界鞬出', { zone: 'hand', handIndex: 0 });

    // 强制命中
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('t1');
    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.turn.vars['界鞬出/quotaBonus']).toBe(1);
    expect(slashMax(harness.state, 0)).toBe(2);
  });

  // ─── 出杀次数+1 累计:两次非基本 → 上限 = 1 + 2 = 3 ─────────────────────
  it('多次发动鞬出弃非基本牌 → 出杀次数累计(两次后上限=3,仍可出第三杀)', async () => {
    const k1 = makeCard('k1', '杀', '♠', '7');
    const k2 = makeCard('k2', '杀', '♠', '8');
    const k3 = makeCard('k3', '杀', '♠', '9');
    const t1 = makeCard('t1', '无中生有', '♥', '7', '锦囊牌');
    const t2 = makeCard('t2', '无中生有', '♥', '8', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界庞德',
          hand: ['k1', 'k2', 'k3'],
          skills: ['杀', '界鞬出'],
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['t1', 't2'], skills: [] }),
      ],
      cardMap: { k1, k2, k3, t1, t2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界庞德');
    const P2 = harness.player('P2');

    // 第一杀:鞬出弃锦囊 → 强制命中,quotaBonus=1
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P0.respond('界鞬出', { choice: true });
    await P2.respond('界鞬出', { zone: 'hand', handIndex: 0 });
    expect(harness.state.turn.vars['界鞬出/quotaBonus']).toBe(1);
    expect(slashMax(harness.state, 0)).toBe(2);

    // 第二杀:鞬出弃锦囊 → 强制命中,quotaBonus=2
    await P0.useCardAndTarget('杀', 'k2', [1]);
    await P0.respond('界鞬出', { choice: true });
    await P2.respond('界鞬出', { zone: 'hand', handIndex: 0 });
    expect(harness.state.turn.vars['界鞬出/quotaBonus']).toBe(2);
    // 上限 = 1 + 2 = 3,已用 2 次 → 还能再出 1 次
    expect(slashMax(harness.state, 0)).toBe(3);

    // 第三杀仍可出(quotaBonus=2 弥补了基础 1 的限制)
    await P0.useCardAndTarget('杀', 'k3', [1]);
    // 目标无牌可弃 → 不触发鞬出,正常询问闪
    await P0.respond('界鞬出', { choice: false });
    P2.expectPending('询问闪');
    await P2.pass();
    // 第三次杀命中(累计扣 3 血)
    expect(harness.state.players[1].health).toBe(1);
  });

  // ─── 不发动鞬出 → 正常询问闪 ─────────────────────────────
  it('界庞德不发动 → 正常询问闪,目标出闪抵消', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界庞德', hand: ['k1'], skills: ['杀', '界鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界庞德');
    const P2 = harness.player('P2');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    P0.expectPending('请求回应');
    await P0.respond('界鞬出', { choice: false });

    // 无鞬出干预 → 询问闪正常进行
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[1].health).toBe(4);
    // 不发动 → 不加 quotaBonus
    expect(harness.state.turn.vars['界鞬出/quotaBonus']).toBeUndefined();
  });

  // ─── 目标无牌可弃 → 鞬出不触发 ─────────────────────────────
  it('目标无牌可弃 → 鞬出不触发,直接询问闪,无闪受伤', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界庞德', hand: ['k1'], skills: ['杀', '界鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界庞德');
    const P2 = harness.player('P2');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // 目标无牌 → 鞬出不询问,直接进入询问闪
    P2.expectPending('询问闪');
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.turn.vars['界鞬出/quotaBonus']).toBeUndefined();
  });

  // ─── 他人出杀 → 鞬出不触发 ─────────────────────────────
  it('他人出杀 → 界鞬出不触发(直接询问闪)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界庞德', skills: ['界鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    // P2 出杀指定界庞德 —— source≠界庞德(界鞬出 owner),界鞬出 after hook 不触发
    await P2.useCardAndTarget('杀', 'k1', [0]);

    // 直接进入询问闪(无 界鞬出/confirm)
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');
  });
});
