// 谦逊(陆逊·锁定技)测试:你不能成为【顺手牵羊】和【乐不思蜀】的目标。
//
// 验证:
//   1. 乐不思蜀对陆逊使用 → 添加延时锦囊被 cancel → 陆逊判定区无乐不思蜀(免疫)
//   2. 顺手牵羊对陆逊使用 → 获得被 cancel → 陆逊手牌/装备不被取走(免疫)
//   3. 负面对照:乐不思蜀/顺手牵羊对非谦逊目标 → 正常生效
//   4. 谦逊不影响反馈/突袭等其他"获得牌"途径(仅限顺手牵羊)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom, pushFrame, popFrame } from '../../src/engine/create-engine';
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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '陆逊',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('谦逊', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 乐不思蜀:免疫 ─────────────────────────
  it('乐不思蜀对陆逊使用 → 判定区不放入乐不思蜀(免疫)', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['l1'],
          skills: ['乐不思蜀', '回合管理'],
          character: '曹操',
        }),
        // P2 = 陆逊(谦逊)
        makePlayer({ index: 1, name: 'P2', skills: ['谦逊'] }),
      ],
      cardMap: { l1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 对陆逊使用乐不思蜀(距离 1,合法目标)
    await P1.triggerAction('乐不思蜀', 'use', { cardId: 'l1', target: 1 });
    await harness.waitForStable();

    // 谦逊生效:添加延时锦囊被 cancel → 判定区为空
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    // 乐不思蜀锦囊本身仍正常进弃牌堆(牌已消耗)
    expect(harness.state.zones.discardPile).toContain('l1');
  });

  // ─── 顺手牵羊:免疫 ─────────────────────────
  //   顺手牵羊 use 流程含 无懈可击 + 选牌 pending,获得 发生在选牌之后。
  //   这里直接在「顺手牵羊」结算帧内触发 获得 atom,精确验证谦逊拦截点。
  it('顺手牵羊获得陆逊的牌 → 获得被 cancel → 不被取走(免疫)', async () => {
    const target = makeCard('t1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          skills: ['顺手牵羊', '回合管理'],
          character: '曹操',
        }),
        // P2 = 陆逊(谦逊),持有 1 张手牌
        makePlayer({ index: 1, name: 'P2', hand: ['t1'], skills: ['谦逊'] }),
      ],
      cardMap: { t1: target },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 模拟顺手牵羊结算帧内的获得操作(顺手牵羊.execute 持有'顺手牵羊'结算帧)
    await pushFrame(harness.state, '顺手牵羊', 0, {});
    const got = await applyAtom(harness.state, { type: '获得', player: 0, cardId: 't1', from: 1 });
    await harness.waitForStable();
    await popFrame(harness.state);

    // 谦逊生效:获得被 cancel(before-hook 返回 false) → 陆逊仍持有 t1
    expect(got).toBe(false);
    expect(harness.state.players[1].hand).toContain('t1');
    expect(harness.state.players[0].hand).not.toContain('t1');
  });

  // ─── 负面对照:乐不思蜀对非谦逊目标正常生效 ───────────
  it('负面:乐不思蜀对非谦逊目标 → 正常放入判定区', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['l1'],
          skills: ['乐不思蜀', '回合管理'],
          character: '曹操',
        }),
        // P2 无谦逊
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'], character: '曹操' }),
      ],
      cardMap: { l1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('乐不思蜀', 'use', { cardId: 'l1', target: 1 });
    await harness.waitForStable();

    // 无谦逊 → 正常放入判定区
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
  });

  // ─── 负面对照:谦逊不阻止反馈等其他获得途径 ───────────
  //   反馈在造成伤害 after-hook 内获得牌,顶帧是伤害来源(非顺手牵羊),谦逊不拦截。
  it('负面:反馈获得陆逊的牌 → 谦逊不拦截(仅限顺手牵羊)', async () => {
    const p2card = makeCard('t1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['反馈'],
          character: '司马懿',
        }),
        // P2 = 陆逊(谦逊),持有 1 张手牌
        makePlayer({ index: 1, name: 'P2', hand: ['t1'], skills: ['谦逊'] }),
      ],
      cardMap: { t1: p2card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接用 获得 atom 模拟反馈拿牌(非顺手牵羊路径,顶帧非'顺手牵羊')
    void applyAtom(harness.state, { type: '获得', player: 0, cardId: 't1', from: 1 });
    await harness.waitForStable();

    // 谦逊不拦截反馈 → 牌被拿走
    expect(harness.state.players[1].hand).not.toContain('t1');
    expect(harness.state.players[0].hand).toContain('t1');
  });
});
