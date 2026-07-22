// 界耀武(界华雄·群·锁定技)测试(界限突破版):
// 核心差异(相对标耀武 — 标版尚未实现):
//   1. 标耀武:被红色【杀】造成伤害时,来源选择回复1点体力或摸一张牌(可选)。
//   2. 界耀武:任何伤害都触发(锁定技,强制),按伤害牌颜色分支:
//        红色 → 来源摸一张牌
//        非红色 / 无 cardId → 华雄摸一张牌
//
// 用例:
//   1. 红色伤害牌(♥杀)→ 来源摸 1 张(华雄不摸)
//   2. 黑色伤害牌(♠杀)→ 华雄摸 1 张(来源不摸)
//   3. 无 cardId 的伤害(纯造成伤害,如闪电抽象)→ 华雄摸 1 张
//   4. 受伤者非华雄(他人受伤)→ 不触发(无人摸牌)
//   5. amount=0 → 不触发(0 伤害不算受伤)
//   6. 红色非杀伤害牌(♦决斗)→ 来源摸 1 张(任何红色牌均触发,不限杀)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState } from '../../src/engine/types';

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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界华雄',
    health: opts.health ?? 6,
    maxHealth: opts.maxHealth ?? 6,
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

/** 给牌堆顶部预填指定 cardId 序列,使 摸牌 atom 按序取这些牌。 */
function preloadDeck(state: GameState, cardIds: string[]): void {
  state.zones.deck = [...cardIds, ...state.zones.deck];
}

describe('界耀武', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 红色伤害牌 → 来源摸一张牌 ─────────────────────────
  it('红色伤害牌(♥杀)→ 来源摸 1 张,华雄不摸', async () => {
    const redSlash = makeCard('rs1', '杀', '♥', '7');
    const topCard = makeCard('top1', '闪', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '界华雄', skills: ['界耀武'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { rs1: redSlash, top1: topCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    preloadDeck(state, ['top1']);
    await harness.setup(state);

    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    // P1 用红色杀对华雄造成 1 点伤害
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 1,
      cardId: 'rs1',
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].health).toBe(5); // 华雄受 1 伤
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore); // 华雄未摸牌
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore + 1); // 来源摸 1
    expect(harness.state.players[1].hand).toContain('top1'); // 摸到的是 top1
  });

  // ─── 2. 黑色伤害牌 → 华雄摸一张牌 ─────────────────────────
  it('黑色伤害牌(♠杀)→ 华雄摸 1 张,来源不摸', async () => {
    const blackSlash = makeCard('bs1', '杀', '♠', '5');
    const topCard = makeCard('top1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '界华雄', skills: ['界耀武'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { bs1: blackSlash, top1: topCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    preloadDeck(state, ['top1']);
    await harness.setup(state);

    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 1,
      cardId: 'bs1',
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].health).toBe(5); // 华雄受 1 伤
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore + 1); // 华雄摸 1
    expect(harness.state.players[0].hand).toContain('top1');
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore); // 来源未摸牌
  });

  // ─── 3. 无 cardId 的伤害 → 华雄摸一张牌(非红色分支)─────────
  it('无 cardId 伤害(如闪电抽象)→ 华雄摸 1 张', async () => {
    const topCard = makeCard('top1', '闪', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '界华雄', skills: ['界耀武'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { top1: topCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    preloadDeck(state, ['top1']);
    await harness.setup(state);

    const p0HandBefore = harness.state.players[0].hand.length;

    // 不带 cardId 的伤害
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 1,
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].health).toBe(5); // 华雄受 1 伤
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore + 1); // 华雄摸 1
    expect(harness.state.players[0].hand).toContain('top1');
  });

  // ─── 4. 受伤者非华雄 → 不触发 ─────────────────────────────
  it('他人受伤(P1)→ 不触发界耀武(无人摸牌)', async () => {
    const redSlash = makeCard('rs1', '杀', '♥', '7');
    const topCard = makeCard('top1', '闪', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '界华雄', skills: ['界耀武'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { rs1: redSlash, top1: topCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    preloadDeck(state, ['top1']);
    await harness.setup(state);

    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    // P0 用红色杀对 P1 造成伤害(P1 不是华雄,不触发界耀武)
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
      cardId: 'rs1',
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(3); // P1 受 1 伤
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore); // 华雄未摸
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore); // P1 也未因耀武摸
  });

  // ─── 5. amount=0 → 不触发(0 伤害不算受伤) ─────────────────
  it('amount=0 不触发界耀武', async () => {
    const redSlash = makeCard('rs1', '杀', '♥', '7');
    const topCard = makeCard('top1', '闪', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '界华雄', skills: ['界耀武'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { rs1: redSlash, top1: topCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    preloadDeck(state, ['top1']);
    await harness.setup(state);

    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 0,
      source: 1,
      cardId: 'rs1',
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].health).toBe(6); // 未受伤
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore); // 无人摸
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore);
  });

  // ─── 6. 红色非杀伤害牌(♦决斗)→ 来源摸 1 张 ────────────────
  it('红色非杀伤害牌(♦决斗)→ 来源摸 1 张', async () => {
    const redDuel = makeCard('rd1', '决斗', '♦', 'Q', '锦囊牌');
    const topCard = makeCard('top1', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '界华雄', skills: ['界耀武'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { rd1: redDuel, top1: topCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    preloadDeck(state, ['top1']);
    await harness.setup(state);

    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 1,
      cardId: 'rd1',
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].health).toBe(5); // 华雄受 1 伤
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore); // 华雄未摸
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore + 1); // 来源摸 1
    expect(harness.state.players[1].hand).toContain('top1');
  });
});
