// 界纵玄(界虞翻·被动技)测试,OL hero/603:
//   当你的牌因弃置而置入弃牌堆后,或你上家的牌于每回合首次因弃置而置入弃牌堆后,
//   你可以将其中任意张牌置于牌堆顶。
//
// 触发方式:通过 applyAtom(弃置, ...) 直接触发弃牌事件。
//
// 验证:
//   A. 自己弃牌 → 触发 → 选1张置顶 → 该牌成为牌堆顶(deck 末尾)
//   B. 自己弃牌 → 触发 → 选2张(顺序)→ 后选的牌成为最顶
//   C. 自己弃牌 → 不发动 → 牌留弃牌堆
//   D. 上家弃牌(本回合首次)→ 触发
//   E. 上家弃牌(本回合第二次)→ 不再触发
//   F. 既非自己也非上家弃牌 → 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
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

/** 触发弃置事件(等稳定并处理事件) */
async function triggerDiscard(
  harness: SkillTestHarness,
  player: number,
  cardIds: string[],
): Promise<void> {
  void applyAtom(harness.state, { type: '弃置', player, cardIds });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界纵玄(界虞翻·被动技)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── A. 自己弃牌 → 选1张置顶 ─────────────────────────────
  it('自己弃[c1,c2] → 发动,选 c1 置顶 → c1 成为牌堆顶(deck 末尾),c2 留弃牌堆', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: ['c1', 'c2', 'keep'],
          skills: ['界纵玄'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: [] }),
      ],
      cardMap: {
        c1: mkCard('c1', '杀'),
        c2: mkCard('c2', '闪'),
        keep: mkCard('keep', '桃'),
      },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');
    const deckLenBefore = harness.state.zones.deck.length;

    await triggerDiscard(harness, 0, ['c1', 'c2']);
    P0.expectPending('请求回应'); // 是否发动

    // 发动
    await P0.respond('界纵玄', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应'); // 选一张牌

    // 选 c1
    await P0.respond('界纵玄', { cardId: 'c1' });
    await harness.waitForStable();
    P0.expectPending('请求回应'); // 是否继续选

    // 不继续
    await P0.respond('界纵玄', { choice: false });
    await harness.waitForStable();

    // c1 成为牌堆顶(deck 末尾)
    expect(harness.state.zones.deck.length).toBe(deckLenBefore + 1);
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('c1');
    // c2 仍在弃牌堆
    expect(harness.state.zones.discardPile).toContain('c2');
    // c1 不在弃牌堆
    expect(harness.state.zones.discardPile).not.toContain('c1');
  });

  // ─── B. 自己弃牌 → 选2张(顺序)→ 后选的牌成为最顶 ─────────
  it('自己弃[c1,c2,c3] → 选 c1 再选 c2 → c2 在最顶,c1 次顶(后选先摸)', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: ['c1', 'c2', 'c3'],
          skills: ['界纵玄'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: [] }),
      ],
      cardMap: {
        c1: mkCard('c1', '杀'),
        c2: mkCard('c2', '闪'),
        c3: mkCard('c3', '桃'),
      },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');
    const deckLenBefore = harness.state.zones.deck.length;

    await triggerDiscard(harness, 0, ['c1', 'c2', 'c3']);
    await P0.respond('界纵玄', { choice: true }); // 发动
    await harness.waitForStable();

    await P0.respond('界纵玄', { cardId: 'c1' }); // 选 c1
    await harness.waitForStable();
    await P0.respond('界纵玄', { choice: true }); // 继续选
    await harness.waitForStable();
    await P0.respond('界纵玄', { cardId: 'c2' }); // 选 c2
    await harness.waitForStable();
    await P0.respond('界纵玄', { choice: false }); // 不继续
    await harness.waitForStable();

    // c2 在最顶(后选先摸),c1 次顶
    expect(harness.state.zones.deck.length).toBe(deckLenBefore + 2);
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('c2');
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 2]).toBe('c1');
    // c3 仍在弃牌堆
    expect(harness.state.zones.discardPile).toContain('c3');
  });

  // ─── C. 自己弃牌 → 不发动 → 牌留弃牌堆 ─────────────────
  it('自己弃[c1] → 不发动 → c1 留弃牌堆,牌堆不变', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: ['c1'],
          skills: ['界纵玄'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: [] }),
      ],
      cardMap: { c1: mkCard('c1', '杀') },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');
    const deckLenBefore = harness.state.zones.deck.length;

    await triggerDiscard(harness, 0, ['c1']);
    P0.expectPending('请求回应');

    // 不发动
    await P0.respond('界纵玄', { choice: false });
    await harness.waitForStable();

    expect(harness.state.zones.deck.length).toBe(deckLenBefore); // 牌堆不变
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── D. 上家弃牌(本回合首次)→ 触发 ─────────────────────
  it('上家(P1)弃[c1] → P0(界虞翻)首次触发', async () => {
    // 2人:P0=界虞翻,P1 是 P0 的上家(findNextAlive(P1)=P0)
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界纵玄'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: ['c1'] }),
      ],
      cardMap: { c1: mkCard('c1', '杀') },
      currentPlayerIndex: 1, // P1 的回合
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    await triggerDiscard(harness, 1, ['c1']);
    P0.expectPending('请求回应'); // P0 触发询问

    // 直接拒绝(本测试只验证触发)
    await P0.respond('界纵玄', { choice: false });
    await harness.waitForStable();

    // 上家触发标记已置位
    expect(harness.state.turn.vars['界纵玄/upstreamTriggeredThisTurn']).toBe(true);
  });

  // ─── E. 上家弃牌(本回合第二次)→ 不再触发 ───────────────
  it('上家(P1)第二次弃牌 → P0 不再触发(每回合首次)', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界纵玄'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: ['c1', 'c2'] }),
      ],
      cardMap: {
        c1: mkCard('c1', '杀'),
        c2: mkCard('c2', '闪'),
      },
      currentPlayerIndex: 1,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    // 第一次:P1 弃 c1 → 触发 → P0 拒绝
    await triggerDiscard(harness, 1, ['c1']);
    P0.expectPending('请求回应');
    await P0.respond('界纵玄', { choice: false });
    await harness.waitForStable();
    expect(harness.state.turn.vars['界纵玄/upstreamTriggeredThisTurn']).toBe(true);

    // 第二次:P1 弃 c2 → 不触发
    await triggerDiscard(harness, 1, ['c2']);
    P0.expectNoPending();
    // c2 仍在弃牌堆
    expect(harness.state.zones.discardPile).toContain('c2');
  });

  // ─── F. 既非自己也非上家弃牌 → 不触发 ───────────────────
  it('非上家的其他角色弃牌 → 不触发(4人场景)', async () => {
    // 4人:P0=界虞翻,P1=下家,P2=非上家也非自己,P3=上家(findNextAlive(P3)=P0)
    // P2 弃牌 → 不是 P0 的上家 → P0 不触发
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界纵玄'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: [] }),
        mkPlayer({ index: 2, name: 'P2', hand: ['c1'] }),
        mkPlayer({ index: 3, name: 'P3', hand: [] }),
      ],
      cardMap: { c1: mkCard('c1', '杀') },
      currentPlayerIndex: 2, // P2 的回合
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    // P2 弃 c1 → P2 不是 P0 的上家(下下家)→ 不触发
    await triggerDiscard(harness, 2, ['c1']);
    P0.expectNoPending();
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.turn.vars['界纵玄/upstreamTriggeredThisTurn']).toBeUndefined();
  });
});
