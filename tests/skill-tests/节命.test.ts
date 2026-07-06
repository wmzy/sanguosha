// 节命(荀彧·被动技)测试
//   当你受到1点伤害后,你可以令一名角色将手牌摸至X张(X为其体力上限且最多为5)。
//
// 验证:
//   1. happy path:受伤 → 选目标 → 目标摸牌至上限
//   2. X 封顶 5:maxHealth>5 时 X=5
//   3. 手牌已满:不摸牌
//   4. 不发动:拒绝
//   5. 选自己:给自己补牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
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
    character: opts.character ?? '荀彧',
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

describe('节命', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── happy path:受伤 → 选目标 → 摸牌至上限 ────────────────────
  it('P1(荀彧)被杀受伤 → 选 P0(4血上限,0手牌) → P0 摸4张', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    // deck 供节命摸牌用
    for (let i = 0; i < 6; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5'];

    const state: GameState = createGameState({
      players: [
        // P0:4 血上限,0 手牌
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀', '闪'] }),
        // P1:荀彧 3 血
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // P0 需要有杀:放到手牌
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪

    // 受伤后:荀彧被询问是否发动节命
    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });

    // 选目标 P0
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 0 });

    // P0 摸至 4 张(体力上限 4,当前 0 手牌)
    expect(harness.state.players[0].hand.length).toBe(4);
    // P1 受伤
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── X 封顶 5:maxHealth>5 时 X=5 ────────────────────
  it('P0(6血上限,0手牌) → X=5(封顶)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    for (let i = 0; i < 8; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5', 'dk6', 'dk7'];

    const state: GameState = createGameState({
      players: [
        // P0:6 血上限(超过 5 封顶),0 手牌
        makePlayer({
          index: 0,
          name: 'P0',
          character: '董卓',
          skills: ['杀', '闪'],
          health: 6,
          maxHealth: 6,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 0 });

    // X = min(6, 5) = 5,P0 摸 5 张
    expect(harness.state.players[0].hand.length).toBe(5);
  });

  // ─── 手牌已满:不摸牌 ────────────────────
  it('P0(4血上限,已有4手牌) → X=4,补牌数=0,不摸', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    // P0 需 4 张手牌
    const p0Cards = ['h1', 'h2', 'h3', 'h4'];
    for (const id of p0Cards) cardMap[id] = makeCard(id, '闪', '♦', '2');
    for (let i = 0; i < 3; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2'];

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '张飞',
          skills: ['杀', '闪'],
          hand: p0Cards,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = [...p0Cards, 'k1']; // P0 有杀+4张
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 0 });

    // P0 原有 4 张(杀已出),X=4,补牌=4-4=0
    expect(harness.state.players[0].hand.length).toBe(4);
  });

  // ─── 不发动:拒绝 ────────────────────
  it('不发动节命:不摸牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀', '闪'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: false });

    // P0 手牌不变(杀已出,0 手牌)
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 选自己:给荀彧补牌 ────────────────────
  it('选自己(P1) → P1 摸至体力上限', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    for (let i = 0; i < 5; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4'];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀'] }),
        // P1:荀彧 3 血上限,受伤后 2 血,0 手牌
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 1 }); // 选自己

    // P1 摸至 3 张(体力上限 3,当前 0 手牌)
    expect(harness.state.players[1].hand.length).toBe(3);
  });
});
