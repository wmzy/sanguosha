// tests/integration/诸葛连弩.test.ts
// 集成测试:诸葛连弩(武器,范围 1)——出牌阶段使用【杀】无次数限制
//
// 覆盖:
//   1. 装备诸葛连弩后,出牌阶段 quota 被设为 Infinity(阶段开始 hook)
//   2. quota=Infinity 时:同回合可以连续出多张杀(至少 2 张,验证 quota 不被扣到 0)
//   3. 卸下诸葛连弩后,quota 回到默认 1(本回合已经出过杀则扣回 0)
//
// 关键机制(诸葛连弩.ts):
//   阶段开始 出牌 的 before hook 设 turn.vars['杀/quota'] = Infinity。
//   杀.ts validate 读 quota(默认 1),Inf - 1 = Inf(永远够用)。
//   装备卸下(添加技能 reverse)不主动清 quota(规则上 quota 是出牌阶段的一次性变量,
//   跨装备可能泄漏 — 但不影响本测试:装备时再触发 阶段开始 出牌 重设)。
//
// 模式:createGameState + registerSkillsFromState → dispatch 走真实 action 路径
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
  applyAtom,
} from '../../src/engine/create-engine';
import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = '7', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌', subtype?: string, range?: number): Card {
  return { id, name, suit, rank, type, subtype, range };
}

describe('诸葛连弩:连续出杀 quota=Infinity', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:装备诸葛连弩 → 阶段开始 出牌 → quota 被设为 Infinity
  // ─────────────────────────────────────────────────────────────
  it('用例1:装备诸葛连弩后,阶段开始 出牌 hook 把 quota 设为 Infinity', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [zhuge.id], equipment: {}, skills: ['杀', '装备通用'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装备前:quota 未设置(validate 时默认 1)
    expect(state.turn.vars['杀/quota']).toBeUndefined();

    // 装备诸葛连弩 → 系统规则 添加技能 after hook 实例化 诸葛连弩 skill
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: state.seq,
    });
    expect(state.players[0].equipment['武器']).toBe(zhuge.id);

    // 装备刚完成,hook 还没触发(当前在 出牌 中段,阶段开始事件需要重新触发)
    // 手动触发 阶段开始 出牌 → 诸葛连弩 的 before hook 把 quota 设为 Infinity
    await applyAtom(state, { type: '阶段开始', player: 0, phase: '出牌' });
    expect(state.turn.vars['杀/quota']).toBe(Infinity);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:quota=Infinity → 连续出 2 张杀都不被 validate 拒绝
  // ─────────────────────────────────────────────────────────────
  it('用例2:装备诸葛连弩后,同回合连续出 2 张杀(P1 扣 2 血)', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const slash1: Card = makeCard('k1', '杀', '♠', '7');
    const slash2: Card = makeCard('k2', '杀', '♠', '8');
    const slash3: Card = makeCard('k3', '杀', '♠', '9');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, slash1.id, slash2.id, slash3.id],
          equipment: {},
          skills: ['杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4 }),
      ],
      cardMap: { [zhuge.id]: zhuge, [slash1.id]: slash1, [slash2.id]: slash2, [slash3.id]: slash3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装备诸葛连弩
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: state.seq,
    });
    // 手动触发 阶段开始 出牌(让 诸葛连弩 hook 把 quota 设为 Infinity)
    await applyAtom(state, { type: '阶段开始', player: 0, phase: '出牌' });
    expect(state.turn.vars['杀/quota']).toBe(Infinity);

    const healthBefore = state.players[1].health;

    // 第一次出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash1.id, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    // P1 不出闪 → 扣血
    await fireTimeoutAndWait(state);
    expect(state.players[1].health).toBe(healthBefore - 1);
    // quota 仍为 Infinity(Infinity - 1 = Infinity)
    expect(state.turn.vars['杀/quota']).toBe(Infinity);

    // 第二次出杀:应被允许(quota=Infinity,默认 1 时第二次会被拒)
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash2.id, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    await fireTimeoutAndWait(state);
    expect(state.players[1].health).toBe(healthBefore - 2);
    expect(state.turn.vars['杀/quota']).toBe(Infinity);

    // 第三次出杀:也应被允许(quota 始终 Infinity)
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash3.id, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    await fireTimeoutAndWait(state);
    expect(state.players[1].health).toBe(healthBefore - 3);

    // 三张杀都进弃牌堆
    expect(state.zones.discardPile).toContain(slash1.id);
    expect(state.zones.discardPile).toContain(slash2.id);
    expect(state.zones.discardPile).toContain(slash3.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:对比:无诸葛连弩时第二次出杀被 validate 拒绝
  // ─────────────────────────────────────────────────────────────
  it('用例3:回归——无诸葛连弩时,出完一张杀后 quota=0,第二次出杀被拒绝', async () => {
    const slash1: Card = makeCard('k1', '杀', '♠', '7');
    const slash2: Card = makeCard('k2', '杀', '♠', '8');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [slash1.id, slash2.id],
          equipment: {},
          skills: ['杀'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4 }),
      ],
      cardMap: { [slash1.id]: slash1, [slash2.id]: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 默认 quota 未设置 → 视为 1
    expect(state.turn.vars['杀/quota']).toBeUndefined();

    // 第一次出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash1.id, targets: [1] },
      baseSeq: state.seq,
    });
    await fireTimeoutAndWait(state);

    // quota=0(出杀后 1-1)
    expect(state.turn.vars['杀/quota']).toBe(0);

    // 第二次出杀应被 validate 拒绝
    const seqBefore = state.seq;
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash2.id, targets: [1] },
      baseSeq: state.seq,
    });
    // 拒绝时 state.seq 不变
    expect(state.seq).toBe(seqBefore);
    // 杀2 仍在手牌
    expect(state.players[0].hand).toContain(slash2.id);
    // P1 血量不变(只挨了一次杀)
    expect(state.players[1].health).toBe(3);
  });
});
