// tests/skill-tests/judge-flow.test.ts
// 模块 H:判定编排函数 runJudgeFlow 时机顺序验证(对齐 docs/flow-redesign.md 模块 H / judge.md)。
// 不依赖具体技能——直接调用编排函数,断言 state.atomHistory 的 atom 时序、判定牌翻出/入弃牌堆、
// 返回值(最终判定牌 cardId)与 牌堆空 早退行为。
//
// 验证点(对齐 docs/flow-redesign.md 模块 H 验收):
//   1. 判定时 atom 在判定之前发出
//   2. 翻出的判定牌最终入弃牌堆,返回该 cardId
//   3. 牌堆空时判定 atom apply 早退(不翻牌),runJudgeFlow 返回 undefined
//   4. 现有 判定 atom 未被修改,仍可独立 apply
//   5. 判定牌生效前/判定牌生效后 atom 已定义且可独立 apply(仅定义,暂不接入编排)
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms'; // 注册所有 atom(含 judge-timing)
import { createGameState } from '../../src/engine/types';
import type { Atom, Card, GameState, PlayerState } from '../../src/engine/types';
import { runJudgeFlow } from '../../src/engine/judge-flow';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';

function makePlayer(opts: {
  index: number;
  name: string;
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeState(opts?: { deckCards?: Card[] }): GameState {
  const cardMap: Record<string, Card> = {};
  for (const c of opts?.deckCards ?? []) cardMap[c.id] = c;
  const state = createGameState({
    players: [
      makePlayer({ index: 0, name: 'P0', health: 4, maxHealth: 4 }),
      makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4 }),
    ],
    cardMap,
    currentPlayerIndex: 0,
    phase: '判定',
    turn: { round: 1, phase: '判定', vars: {} },
  });
  state.zones.deck = (opts?.deckCards ?? []).map((c) => c.id);
  return state;
}

/** 取 state.atomHistory 中所有 atom 事件(跳过 notify)的 type 序列。 */
function atomTypes(state: GameState): string[] {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom.type);
}

describe('模块 H:判定编排函数 runJudgeFlow', () => {
  let state: GameState;
  beforeEach(() => {
    state = makeState({
      deckCards: [makeCard('j1', '判定牌', '♠', '7')],
    });
  });

  // ── 时机顺序 ───────────────────────────────────────────────
  it('判定时 atom 在判定之前发出', async () => {
    await runJudgeFlow(state, 0, '乐不思蜀');
    const types = atomTypes(state);
    expect(types).toContain('判定时');
    expect(types).toContain('判定');
    // 判定时 严格先于 判定
    expect(types.indexOf('判定时')).toBeLessThan(types.indexOf('判定'));
  });

  it('完整时序:判定时 → 判定', async () => {
    await runJudgeFlow(state, 0, '闪电');
    // 判定牌生效前/生效后 暂不接入编排(仅定义)——故时序只含 判定时 + 判定
    expect(atomTypes(state)).toEqual(['判定时', '判定']);
  });

  // ── 判定牌翻出 / 入弃牌堆 / 返回值 ─────────────────────────
  it('翻出的判定牌最终入弃牌堆,runJudgeFlow 返回该 cardId', async () => {
    const cardId = await runJudgeFlow(state, 0, '乐不思蜀');
    expect(cardId).toBe('j1');
    // 牌堆清空
    expect(state.zones.deck).toEqual([]);
    // 判定牌进弃牌堆
    expect(state.zones.discardPile).toEqual(['j1']);
    // localVars 回写(与原 判定 atom 行为一致)
    expect(state.localVars['判定/finalJudgeCardId']).toBe('j1');
  });

  // ── 牌堆空早退 ─────────────────────────────────────────────
  it('牌堆空时判定 atom apply 早退,runJudgeFlow 返回 undefined', async () => {
    const emptyState = makeState({ deckCards: [] });
    const cardId = await runJudgeFlow(emptyState, 0, '乐不思蜀');
    // 判定 atom apply 因 deck 为空早退,未翻牌 → afterHooks 无 cardId 回写
    expect(cardId).toBeUndefined();
    expect(emptyState.zones.discardPile).toEqual([]);
    // 判定时 仍发出(在 判定 之前)
    const types = atomTypes(emptyState);
    expect(types).toContain('判定时');
  });

  // ── 不重构 判定 atom:仍可独立 apply ────────────────────────
  it('现有 判定 atom 未被修改,仍可独立 apply', async () => {
    await applyAtom(state, { type: '判定', player: 0, judgeType: '乐不思蜀' });
    // 直接 apply 判定 不经过 判定时(编排函数才发 判定时)
    expect(atomTypes(state)).toEqual(['判定']);
    expect(state.zones.discardPile).toEqual(['j1']);
  });

  // ── 判定牌生效前/生效后 atom 已定义,可独立 apply ──────────
  it('判定牌生效前 / 判定牌生效后 atom 已定义且可独立 apply', async () => {
    // 这两个 atom 仅定义,暂不接入 runJudgeFlow 编排;验证其可独立 apply(纯标记无副作用)
    await applyAtom(state, { type: '判定牌生效前', player: 0, judgeType: '八卦阵', cardId: 'j1' });
    await applyAtom(state, { type: '判定牌生效后', player: 0, judgeType: '八卦阵', cardId: 'j1' });
    const types = atomTypes(state);
    expect(types).toEqual(['判定牌生效前', '判定牌生效后']);
    // 无副作用:牌堆/弃牌堆不变
    expect(state.zones.discardPile).toEqual([]);
  });
});
