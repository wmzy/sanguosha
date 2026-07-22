// 界镇军(界于禁·魏·主动技)测试:
//   准备阶段,你可以弃置一名角色X张牌(X为其手牌数减体力值且至少为1),
//   然后选择一项:
//     1.你弃置与其中非装备牌数等量张牌
//     2.结束阶段,其摸与其中非装备牌数等量张牌
//
// 用例:
//   1. 选项1:准备阶段发动,弃置目标X张牌,选1 → 自己弃N张
//   2. 选项2:准备阶段发动,弃置目标X张牌,选2 → 结束阶段目标摸N张
//   3. 不发动 → 无效果
//   4. X 计算正确:手牌-体力,最小1
//   5. 装备牌计入X但不计入N(非装备牌数)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
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
  equipment?: Record<string, string>;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界于禁',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

/** 触发准备阶段开始(推动 after-hook) */
async function startPrepare(harness: SkillTestHarness, player: number): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '准备' });
  await waitForStable(harness.state);
}

/** 触发结束阶段开始(推动延迟摸牌 after-hook) */
async function startEnd(harness: SkillTestHarness, player: number): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '回合结束' });
  await waitForStable(harness.state);
}

describe('界镇军', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 选项1:准备阶段发动 → 弃目标X张 → 自己弃N张 ─────────────

  it('选项1:发动镇军弃 P1 X=3 张手牌,选选项1 → 自己弃 N=3 张手牌', async () => {
    // P1 手牌5,体力2 → X = 5-2 = 3
    // P0 手牌3 → 弃 N=3 (P1 全是手牌,N=3)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['m1', 'm2', 'm3'],
          skills: ['界镇军'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2', 't3', 't4', 't5'], // 5 张手牌
          skills: [],
          health: 2,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        m1: makeCard('m1', '杀'),
        m2: makeCard('m2', '闪', '♥'),
        m3: makeCard('m3', '桃', '♦'),
        t1: makeCard('t1', '杀'),
        t2: makeCard('t2', '闪', '♥'),
        t3: makeCard('t3', '桃', '♦'),
        t4: makeCard('t4', '酒', '♣'),
        t5: makeCard('t5', '杀', '♠', 'K'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 触发准备阶段 → after-hook 询问发动
    await startPrepare(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界镇军', { choice: true }); // 发动
    await waitForStable(harness.state);

    // 询问目标
    await P0.respond('界镇军', { target: 1 });
    await waitForStable(harness.state);

    // 询问选 X=3 张目标牌
    await P0.respond('界镇军', { cardIds: ['t1', 't2', 't3'] });
    await waitForStable(harness.state);

    // 询问选项
    await P0.respond('界镇军', { option: 'self' });
    await waitForStable(harness.state);

    // 询问选 N=3 张自己手牌
    await P0.respond('界镇军', { cardIds: ['m1', 'm2', 'm3'] });
    await waitForStable(harness.state);

    // 验证:P1 弃了3张(t1/t2/t3);P0 弃了3张(m1/m2/m3)
    expect(harness.state.players[1].hand).toEqual(['t4', 't5']);
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toEqual(
      expect.arrayContaining(['t1', 't2', 't3', 'm1', 'm2', 'm3']),
    );
    // 已用标记
    expect(harness.state.turn.vars['界镇军/usedThisTurn']).toBe(true);
  });

  // ─── 选项2:准备阶段发动 → 弃目标X张 → 结束阶段目标摸N张 ───

  it('选项2:发动镇军弃 P1 X=2 张手牌,选选项2 → 结束阶段 P1 摸 N=2 张', async () => {
    // P1 手牌4,体力2 → X = 4-2 = 2
    // 选选项2:延迟摸牌 → 结束阶段 P1 摸 N=2
    const deckTop1 = makeCard('d1', '杀');
    const deckTop2 = makeCard('d2', '闪', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界镇军'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2', 't3', 't4'],
          skills: [],
          health: 2,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        d1: deckTop1,
        d2: deckTop2,
        t1: makeCard('t1', '杀'),
        t2: makeCard('t2', '闪', '♥'),
        t3: makeCard('t3', '桃', '♦'),
        t4: makeCard('t4', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    // 牌堆顶放 d1, d2(摸牌从末尾抽,末尾为顶,期望摸顺序:d1→d2)
    state.zones = { deck: ['d2', 'd1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 触发准备阶段
    await startPrepare(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界镇军', { choice: true }); // 发动
    await waitForStable(harness.state);

    await P0.respond('界镇军', { target: 1 });
    await waitForStable(harness.state);

    // X=2:弃 t1, t2
    await P0.respond('界镇军', { cardIds: ['t1', 't2'] });
    await waitForStable(harness.state);

    // 选选项2
    await P0.respond('界镇军', { option: 'defer' });
    await waitForStable(harness.state);

    // 中间状态:P1 已被弃 2 张(t1, t2),未摸牌
    expect(harness.state.players[1].hand).toEqual(['t3', 't4']);
    // 延迟条目已记录
    expect(harness.state.turn.vars['界镇军/deferDraw']).toEqual({ target: 1, count: 2 });

    // 触发结束阶段 → 目标摸 N=2 张
    await startEnd(harness, 0);

    expect(harness.state.players[1].hand).toEqual(['t3', 't4', 'd1', 'd2']);
    // 延迟条目已被消费
    expect(harness.state.turn.vars['界镇军/deferDraw']).toBeUndefined();
  });

  // ─── 不发动 → 无效果 ─────────────────────────────────────

  it('不发动镇军 → 无副作用,usedThisTurn 标记被撤销', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界镇军'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1'],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { t1: makeCard('t1', '杀') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await startPrepare(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界镇军', { choice: false }); // 不发动
    await waitForStable(harness.state);

    // 状态不变,标记撤销
    expect(harness.state.players[1].hand).toEqual(['t1']);
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.turn.vars['界镇军/usedThisTurn']).toBeUndefined();
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── X 计算正确:手牌-体力,最小为1 ─────────────────────

  it('X 计算边界:P1 手牌2-体力4=-2 → X 至少为1', async () => {
    // P1 手牌2,体力4 → X = max(2-4, 1) = 1
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['m1'],
          skills: ['界镇军'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2'], // 手牌2
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        m1: makeCard('m1', '杀'),
        t1: makeCard('t1', '杀'),
        t2: makeCard('t2', '闪', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await startPrepare(harness, 0);
    await P0.respond('界镇军', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界镇军', { target: 1 });
    await waitForStable(harness.state);

    // 询问选 X 张:此时只允许选 1 张(validate 校验)
    // 选 t1(1 张)→ 应被接受
    await P0.respond('界镇军', { cardIds: ['t1'] });
    await waitForStable(harness.state);

    // 此时 N=1(只有 t1 是非装备)
    await P0.respond('界镇军', { option: 'self' });
    await waitForStable(harness.state);

    // 选自己 N=1 张手牌
    await P0.respond('界镇军', { cardIds: ['m1'] });
    await waitForStable(harness.state);

    expect(harness.state.players[1].hand).toEqual(['t2']);
    expect(harness.state.players[0].hand).toEqual([]);
  });

  // ─── 装备牌计入 X 但不计入 N(非装备牌数) ───────────────

  it('装备牌:弃置含1装备+1手牌,共2张 → N=1(只算手牌)', async () => {
    // P1 手牌2+装备1,体力2 → X = max(2-2, 1) = 1;但本测试想验证装备牌计入X,
    // 改为 P1 手牌3+装备1,体力1 → X = 3-1 = 2(从手牌+装备任选2)
    const weapon = makeCard('rw', '仁王盾', '♣', '2', '装备牌');
    (weapon as Card & { subtype?: string }).subtype = '防具';
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['m1'], // 1 张手牌
          skills: ['界镇军'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2', 't3'], // 3 手牌
          equipment: { 防具: 'rw' }, // 1 防具
          skills: [],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        m1: makeCard('m1', '杀'),
        rw: weapon,
        t1: makeCard('t1', '杀'),
        t2: makeCard('t2', '闪', '♥'),
        t3: makeCard('t3', '桃', '♦'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await startPrepare(harness, 0);
    await P0.respond('界镇军', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界镇军', { target: 1 });
    await waitForStable(harness.state);

    // X = 3-1 = 2:选 1 张手牌 t1 + 1 张装备 rw → N=1(只 t1 非装备)
    await P0.respond('界镇军', { cardIds: ['t1', 'rw'] });
    await waitForStable(harness.state);

    // 询问选项:N=1,P0 手牌恰好 1 张,可选项1
    await P0.respond('界镇军', { option: 'self' });
    await waitForStable(harness.state);

    // 选 N=1 张
    await P0.respond('界镇军', { cardIds: ['m1'] });
    await waitForStable(harness.state);

    // 验证:P1 手牌剩 t2,t3;防具被弃
    expect(harness.state.players[1].hand).toEqual(['t2', 't3']);
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toEqual(
      expect.arrayContaining(['t1', 'rw', 'm1']),
    );
  });

  // ─── 选项2延迟摸牌在目标已死亡时不摸 ───────────────────

  it('选项2延迟摸牌:目标在结束阶段前死亡 → 不摸牌(无异常)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界镇军'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2', 't3'], // 3 手牌,health=1 → X = 3-1 = 2
          skills: [],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        t1: makeCard('t1', '杀'),
        t2: makeCard('t2', '闪', '♥'),
        t3: makeCard('t3', '桃', '♦'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await startPrepare(harness, 0);
    await P0.respond('界镇军', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界镇军', { target: 1 });
    await waitForStable(harness.state);
    await P0.respond('界镇军', { cardIds: ['t1', 't2'] });
    await waitForStable(harness.state);
    await P0.respond('界镇军', { option: 'defer' });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['界镇军/deferDraw']).toEqual({ target: 1, count: 2 });

    // 模拟目标在结束阶段前死亡
    harness.state.players[1].alive = false;

    // 触发结束阶段 → 不摸牌(alive=false)
    await startEnd(harness, 0);

    // 手牌仍是原始剩余(t3 未被弄走,目标未摸牌)
    expect(harness.state.players[1].hand).toEqual(['t3']);
    // 条目被消费
    expect(harness.state.turn.vars['界镇军/deferDraw']).toBeUndefined();
  });
});
