// 攻心(界吕蒙·吴·衍生技)行为测试,OL hero/306:
//   "出牌阶段限一次,你可以观看一名其他角色的手牌,然后你可以展示其中一张♥牌
//    并选择一项:1.弃置此牌;2.将此牌置于牌堆顶。"
//
// 覆盖:
//   1. 选♥牌 → 弃置:目标该♥牌进弃牌堆、离开手牌
//   2. 选♥牌 → 置牌堆顶:该牌成为牌堆顶(deck 末尾)、离开目标手牌
//   3. 目标无♥牌:观看后无可展示,技能结束(已计一次)
//   4. 放弃展示(pass):技能结束,目标手牌不变
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
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

describe('攻心', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 选♥牌 → 弃置 ───────────────────────────────────
  it('观看并选♥牌 → 选弃置 → 目标该♥牌进弃牌堆、离开手牌', async () => {
    const heart = mkCard('h1', '杀', '♥', '7');
    const spade = mkCard('s1', '闪', '♠', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界吕蒙', hand: [], skills: ['攻心'] }),
          mkPlayer({ index: 1, name: '目标', hand: ['h1', 's1'] }),
        ],
        cardMap: { h1: heart, s1: spade },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LM = harness.player('界吕蒙');

    // 发动攻心,选目标 1
    await LM.triggerAction('攻心', 'use', { targets: [1] });
    await harness.waitForStable();
    LM.expectPending('请求回应'); // 选♥牌

    // 选目标的♥牌 h1
    await LM.respond('攻心', { cardId: 'h1' });
    await harness.waitForStable();
    LM.expectPending('请求回应'); // 二选一

    // 选弃置(choice=true)
    await LM.respond('攻心', { choice: true });
    await harness.waitForStable();

    expect(harness.state.zones.discardPile).toContain('h1');
    expect(harness.state.players[1].hand).not.toContain('h1');
    expect(harness.state.players[1].hand).toContain('s1'); // 非♥牌保留
    expect(harness.state.players[0].vars['攻心/usedThisTurn']).toBe(true);
  });

  // ─── 2. 选♥牌 → 置牌堆顶 ───────────────────────────────
  it('观看并选♥牌 → 选置牌堆顶 → 该牌成为牌堆顶(deck 末尾)、离开目标手牌', async () => {
    const heart = mkCard('h1', '桃', '♥', 'Q');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界吕蒙', hand: [], skills: ['攻心'] }),
          mkPlayer({ index: 1, name: '目标', hand: ['h1'] }),
        ],
        cardMap: { h1: heart },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LM = harness.player('界吕蒙');
    const deckLenBefore = harness.state.zones.deck.length;

    await LM.triggerAction('攻心', 'use', { targets: [1] });
    await harness.waitForStable();
    await LM.respond('攻心', { cardId: 'h1' }); // 选♥牌
    await harness.waitForStable();
    await LM.respond('攻心', { choice: false }); // 选置牌堆顶
    await harness.waitForStable();

    // h1 离开目标手牌,成为牌堆顶(deck 末尾)
    expect(harness.state.players[1].hand).not.toContain('h1');
    expect(harness.state.zones.discardPile).not.toContain('h1');
    expect(harness.state.zones.deck.length).toBe(deckLenBefore + 1);
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('h1');
  });

  // ─── 3. 目标无♥牌:观看后无可展示,技能结束 ─────────────
  it('目标无♥牌 → 发动后无选牌询问,直接结束(已计一次)', async () => {
    const spade = mkCard('s1', '闪', '♠', '3');
    const club = mkCard('c1', '杀', '♣', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界吕蒙', hand: [], skills: ['攻心'] }),
          mkPlayer({ index: 1, name: '目标', hand: ['s1', 'c1'] }),
        ],
        cardMap: { s1: spade, c1: club },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LM = harness.player('界吕蒙');

    await LM.triggerAction('攻心', 'use', { targets: [1] });
    await harness.waitForStable();

    // 无♥牌 → 不弹选牌询问,技能直接结束
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].hand.length).toBe(2); // 手牌不变
    expect(harness.state.players[0].vars['攻心/usedThisTurn']).toBe(true); // 仍计一次
  });

  // ─── 4. 放弃展示(pass)→ 技能结束,目标手牌不变 ──────────
  it('观看后放弃展示(pass)→ 技能结束,目标手牌不变', async () => {
    const heart = mkCard('h1', '杀', '♥', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界吕蒙', hand: [], skills: ['攻心'] }),
          mkPlayer({ index: 1, name: '目标', hand: ['h1'] }),
        ],
        cardMap: { h1: heart },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LM = harness.player('界吕蒙');

    await LM.triggerAction('攻心', 'use', { targets: [1] });
    await harness.waitForStable();
    LM.expectPending('请求回应'); // 选♥牌询问

    // 放弃(pass = 不展示)
    await LM.pass();
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0); // 技能结束
    expect(harness.state.players[1].hand).toContain('h1'); // 手牌不变
    expect(harness.state.zones.discardPile).not.toContain('h1');
    expect(harness.state.players[0].vars['攻心/usedThisTurn']).toBe(true);
  });
});
