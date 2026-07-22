// 界宗室(界刘表·群·锁定技)测试:
//   锁定技,你的手牌上限+X(X为全场势力数)。其他角色对你造成伤害时,
//   防止此伤害改为令其摸一张牌,每种势力限一次。
//
// 官方来源:OL 界限突破 hero/626。
//
// 验证:
//   1. 手牌上限+X:health+X 为上限,弃牌阶段按此结算
//   2. 防伤改摸牌:其他角色造成伤害 → 防止 + 来源摸 1 张
//   3. 每种势力限一次:同势力第二次伤害不防止,照常受伤
//   4. 自伤不触发:刘表自伤 → 照常受伤
//   5. 无来源伤害不触发:无 source 的伤害照常生效
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

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
  faction?: PlayerState['faction'];
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction,
  };
}

/** 当前唯一 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return null;
  return (slots[0].atom as unknown as { requestType?: string }).requestType ?? null;
}

/** __弃牌 pending 要求弃的牌数(cardFilter.min),无 __弃牌 返回 null */
function discardExcess(state: GameState): number | null {
  for (const slot of state.pendingSlots.values()) {
    const atom = slot.atom as {
      requestType?: string;
      prompt?: { cardFilter?: { min?: number } };
    };
    if (atom.requestType === '__弃牌') {
      return atom.prompt?.cardFilter?.min ?? null;
    }
  }
  return null;
}

describe('界宗室', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 手牌上限+X:health+X 为上限 ────────────────────
  it('手牌上限=health+X:health=3,X=2 → 上限 5,手牌 5 不弃', async () => {
    const hand = [
      makeCard('h1', '杀', '♠', '2'),
      makeCard('h2', '闪', '♥', '3'),
      makeCard('h3', '桃', '♦', '4'),
      makeCard('h4', '酒', '♣', '5'),
      makeCard('h5', '杀', '♠', '7'),
    ];
    const cardMap: Record<string, Card> = {};
    for (const c of hand) cardMap[c.id] = c;

    await harness.setup(
      createGameState({
        players: [
          // health=3, X=2(群+魏)→ 上限=5;手牌 5 → 不弃
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: hand.map((c) => c.id),
            skills: ['界宗室', '回合管理'],
            health: 3,
            maxHealth: 3,
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理'],
          }),
        ],
        cardMap,
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('界刘表');

    const restoreAutoCompare = disableAutoCompare();

    // 结束出牌阶段 → 弃牌阶段
    await P0.triggerAction('回合管理', 'end', {});

    // 上限=3+2=5,手牌=5 → 无需弃牌
    expect(currentRequestType(harness.state)).not.toBe('__弃牌');
    expect(harness.state.players[0].hand.length).toBe(5);

    restoreAutoCompare();
  });

  // ─── 1b. 手牌>health+X:超出部分弃 ────────────────────
  it('手牌上限=health+X:health=3,X=2,手牌 7 → 弃 2', async () => {
    const hand = [
      makeCard('h1', '杀', '♠', '2'),
      makeCard('h2', '闪', '♥', '3'),
      makeCard('h3', '桃', '♦', '4'),
      makeCard('h4', '酒', '♣', '5'),
      makeCard('h5', '杀', '♠', '7'),
      makeCard('h6', '闪', '♥', '8'),
      makeCard('h7', '桃', '♦', '9'),
    ];
    const cardMap: Record<string, Card> = {};
    for (const c of hand) cardMap[c.id] = c;

    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: hand.map((c) => c.id),
            skills: ['界宗室', '回合管理'],
            health: 3,
            maxHealth: 3,
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理'],
          }),
        ],
        cardMap,
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('界刘表');

    const restoreAutoCompare = disableAutoCompare();

    await P0.triggerAction('回合管理', 'end', {});

    // 上限=3+2=5,手牌=7 → 弃 2
    expect(currentRequestType(harness.state)).toBe('__弃牌');
    expect(discardExcess(harness.state)).toBe(2);

    restoreAutoCompare();
  });

  // ─── 2. 防伤改摸牌:其他角色造成伤害 → 防止 + 来源摸 1 ───
  it('防伤改摸牌:P1 杀刘表 → 防止伤害,P1 摸 1 张', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const deckCards = [makeCard('d1', '闪', '♥', '2')];
    const cardMap: Record<string, Card> = { s1: slash };
    for (const c of deckCards) cardMap[c.id] = c;

    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: [],
            skills: ['界宗室', '闪', '回合管理'],
            health: 3,
            maxHealth: 3,
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            hand: [slash.id],
            skills: ['杀', '回合管理'],
            health: 3,
            maxHealth: 3,
          }),
        ],
        cardMap,
        zones: {
          deck: deckCards.map((c) => c.id),
          discardPile: [],
          processing: [],
        },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LH = harness.player('界刘表');

    const restoreAutoCompare = disableAutoCompare();

    // P1 对刘表出杀
    await harness.player('P1').useCardAndTarget('杀', 's1', [0]);
    await LH.pass(); // 刘表不出闪
    await harness.waitForStable();

    // 验证:伤害被防止(刘表体力仍为 3)
    expect(harness.state.players[0].health).toBe(3);
    // 来源 P1 摸 1 张
    expect(harness.state.players[1].hand.length).toBe(1);
    // 魏 势力已用标记
    expect(harness.state.players[0].vars['宗室/防伤/魏']).toBe(true);

    restoreAutoCompare();
  });

  // ─── 3. 每种势力限一次:同势力第二次伤害不防止 ────────────
  //    使用 applyAtom 直接模拟伤害,避免杀次数限制干扰。
  it('每种势力限一次:魏第二次伤害 → 照常受伤', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: [],
            skills: ['界宗室', '回合管理'],
            health: 3,
            maxHealth: 3,
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理'],
            health: 3,
            maxHealth: 3,
          }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const restoreAutoCompare = disableAutoCompare();

    // 第一次魏来源伤害:防止
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 1,
    });
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].vars['宗室/防伤/魏']).toBe(true);

    // 第二次魏来源伤害:魏已用过 → 照常受伤
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 1,
    });
    expect(harness.state.players[0].health).toBe(2);

    restoreAutoCompare();
  });

  // ─── 4. 自伤不触发:刘表自伤 → 照常受伤 ────────────────
  it('自伤不触发:刘表自伤(source=self) → 照常受伤', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: [],
            skills: ['界宗室', '回合管理'],
            health: 3,
            maxHealth: 3,
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理'],
          }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const restoreAutoCompare = disableAutoCompare();

    // 直接 applyAtom 造成自伤(source=target=0)
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 0,
    });

    // 自伤照常生效(体力 -1)
    expect(harness.state.players[0].health).toBe(2);
    // 未设防伤标记
    expect(harness.state.players[0].vars['宗室/防伤/群']).toBeUndefined();

    restoreAutoCompare();
  });

  // ─── 5. 不同势力均可触发:魏+蜀各防一次 ────────────────
  //    使用 applyAtom 直接模拟伤害,避免跨回合并杀问题。
  it('不同势力均可触发一次:魏防后蜀仍可防', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: [],
            skills: ['界宗室', '回合管理'],
            health: 3,
            maxHealth: 3,
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理'],
          }),
          makePlayer({
            index: 2,
            name: 'P2',
            faction: '蜀',
            skills: ['回合管理'],
          }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const restoreAutoCompare = disableAutoCompare();

    // 魏来源伤害:防止
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 1,
    });
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].vars['宗室/防伤/魏']).toBe(true);

    // 蜀来源伤害:防止(不同势力,各自一次)
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: 2,
    });
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].vars['宗室/防伤/蜀']).toBe(true);

    // 群(自己)势力未触发(无自伤)
    expect(harness.state.players[0].vars['宗室/防伤/群']).toBeUndefined();

    restoreAutoCompare();
  });
});
