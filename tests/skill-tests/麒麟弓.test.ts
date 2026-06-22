// tests/skill-tests/麒麟弓.test.ts
// 麒麟弓(武器,范围 5):杀造成伤害时,可弃目标1匹马(不防止伤害)。
//
// 覆盖:
//   1. 杀命中 + 装备麒麟弓 + 目标有马 → 询问 → 确认 → 弃马 + 伤害照常
//   2. 杀命中 + 装备麒麟弓 + 询问 → 不发动 → 伤害照常 + 目标马保留
//   3. 杀命中 + 装备麒麟弓 + 目标无马 → 不询问(直接伤害)
//   4. 杀命中 + 无麒麟弓 → 不触发弃马
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, Json, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as Record<string, Json>,
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

describe('麒麟弓:杀造成伤害时可弃目标1匹马', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 杀命中 + 确认弃马 → 弃进攻马 + 伤害照常
  // ─────────────────────────────────────────────────────────────
  it('用例1:P0 麒麟弓杀P1(持进攻马)→ 确认发动 → P1 马被弃 + 扣1血', async () => {
    const qilin: Card = { id: 'wp-ql', name: '麒麟弓', suit: '♥', rank: '5', type: '装备牌', subtype: '武器', range: 5 };
    const mount: Card = { id: 'mt-chitu', name: '赤兔', suit: '♥', rank: '5', type: '装备牌', subtype: '进攻马' };
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [slash.id],
          // 出杀范围设为 5(麒麟弓已装备)
          equipment: { 武器: qilin.id },
          skills: ['杀', '装备通用', '麒麟弓'],
          vars: { '距离/出杀范围': 5 },
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: { 进攻马: mount.id },
          skills: ['闪'],
        }),
      ],
      cardMap: {
        [qilin.id]: qilin,
        [mount.id]: mount,
        [slash.id]: slash,
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const p1HealthBefore = state.players[1].health;

    // P0 出杀
    await dispatchAndWait(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: slash.id, targets: [1] }, baseSeq: state.seq,
    });

    // 先到 询问闪 pending
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    // P1 不出闪
    await fireTimeoutAndWait(state);

    // 杀命中 → 麒麟弓询问弃马 pending
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    // P0 确认发动(出 respond)
    await dispatchAndWait(state, {
      skillId: '麒麟弓', actionType: 'respond', ownerId: 0,
      params: { choice: true }, baseSeq: state.seq,
    });

    // 关键断言:B1 进攻马被弃 + 扣1血
    expect(state.players[1].equipment['进攻马']).toBeUndefined();
    expect(state.zones.discardPile).toContain(mount.id);
    expect(state.players[1].health).toBe(p1HealthBefore - 1);
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 杀命中 + 不发动 → 目标马保留 + 伤害照常
  // ─────────────────────────────────────────────────────────────
  it('用例2:P0 麒麟弓杀P1(持进攻马)→ 不发动 → P1 马保留 + 扣1血', async () => {
    const qilin: Card = { id: 'wp-ql', name: '麒麟弓', suit: '♥', rank: '5', type: '装备牌', subtype: '武器', range: 5 };
    const mount: Card = { id: 'mt-chitu', name: '赤兔', suit: '♥', rank: '5', type: '装备牌', subtype: '进攻马' };
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [slash.id],
          equipment: { 武器: qilin.id },
          skills: ['杀', '装备通用', '麒麟弓'],
          vars: { '距离/出杀范围': 5 },
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: { 进攻马: mount.id },
          skills: ['闪'],
        }),
      ],
      cardMap: {
        [qilin.id]: qilin,
        [mount.id]: mount,
        [slash.id]: slash,
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const p1HealthBefore = state.players[1].health;

    await dispatchAndWait(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: slash.id, targets: [1] }, baseSeq: state.seq,
    });

    // 询问闪
    await fireTimeoutAndWait(state);

    // 麒麟弓询问 → P0 超时(等同不发动)
    await fireTimeoutAndWait(state);

    // B1 马保留 + 扣1血
    expect(state.players[1].equipment['进攻马']).toBe(mount.id);
    expect(state.players[1].health).toBe(p1HealthBefore - 1);
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 杀命中 + 目标无马 → 不询问
  // ─────────────────────────────────────────────────────────────
  it('用例3:P0 麒麟弓杀P1(无马)→ 不询问,直接扣血', async () => {
    const qilin: Card = { id: 'wp-ql', name: '麒麟弓', suit: '♥', rank: '5', type: '装备牌', subtype: '武器', range: 5 };
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [slash.id],
          equipment: { 武器: qilin.id },
          skills: ['杀', '装备通用', '麒麟弓'],
          vars: { '距离/出杀范围': 5 },
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: {},
          skills: ['闪'],
        }),
      ],
      cardMap: { [qilin.id]: qilin, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const p1HealthBefore = state.players[1].health;

    await dispatchAndWait(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: slash.id, targets: [1] }, baseSeq: state.seq,
    });

    // 询问闪
    await fireTimeoutAndWait(state);

    // 杀命中后无麒麟弓询问(B1 无马)→ 直接扣血
    expect(state.players[1].health).toBe(p1HealthBefore - 1);
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 回归:无麒麟弓时,杀命中后不触发弃马
  // ─────────────────────────────────────────────────────────────
  it('用例4:无麒麟弓时,杀命中后不触发弃马询问', async () => {
    const mount: Card = { id: 'mt-chitu', name: '赤兔', suit: '♥', rank: '5', type: '装备牌', subtype: '进攻马' };
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [slash.id],
          equipment: {},
          skills: ['杀', '装备通用'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: { 进攻马: mount.id },
          skills: ['闪'],
        }),
      ],
      cardMap: { [mount.id]: mount, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const p1HealthBefore = state.players[1].health;

    await dispatchAndWait(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: slash.id, targets: [1] }, baseSeq: state.seq,
    });

    // 询问闪
    await fireTimeoutAndWait(state);

    // 杀命中 → 无麒麟弓 → 直接扣血,马保留
    expect(state.players[1].equipment['进攻马']).toBe(mount.id);
    expect(state.players[1].health).toBe(p1HealthBefore - 1);
    expect(state.pendingSlots.size).toBe(0);
  });
});
