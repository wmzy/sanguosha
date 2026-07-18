// tests/skill-tests/界节命.test.ts
// 界节命(界荀彧·被动技) OL 官方逐字:
//   "当你受到1点伤害后或死亡时,你可以令一名角色摸X张牌,然后将手牌弃至X张
//    (X为其体力上限且至多为5)。"
//
// 与标版节命关键差异(必须验证):
//   1. 受伤后触发:先摸 X 张,然后弃至 X 张(非「摸至 X 张」)
//   2. 死亡时触发:击杀 before-hook,选目标摸弃(标版无)
//   3. 无额外摸牌(标版旧实现「若目标原手牌为0,你摸一张牌」已移除)
//
// 验证:
//   1. 受伤 happy path:0手牌目标 → 摸 X 张,无需弃
//   2. X 封顶 5:maxHealth>5 时 X=5
//   3. 关键差异·先摸后弃:目标原有 N 手牌 → 摸 X 张 → 弃至 X 张
//   4. 不发动:拒绝
//   5. 选自己:给自己摸弃
//   6. 死亡时触发:荀彧被杀死亡 → 仍可发动节命 → 选目标摸弃
//   7. 目标手牌已 ≤ X:摸后超 X 才弃,不超不弃
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
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
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
    character: opts.character ?? '界荀彧',
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

describe('界节命', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 受伤 happy path:0手牌目标 → 摸 X 张,无需弃 ────────────────────
  it('P1(界荀彧)被杀受伤 → 选 P0(4血上限,0手牌) → P0 摸4张(无弃)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    for (let i = 0; i < 6; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5'];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀', '闪'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界节命', '闪'],
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
    await P1.pass(); // 不出闪

    // 受伤后:荀彧被询问是否发动节命
    P1.expectPending('请求回应');
    await P1.respond('界节命', { choice: true });

    // 选目标 P0
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // P0 摸 4 张(X = min(4, 5) = 4,原 0 手牌,摸后 4 张,无需弃)
    expect(harness.state.players[0].hand.length).toBe(4);
    expect(harness.state.pendingSlots.size).toBe(0);
    // P1 受伤
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── X 封顶 5:maxHealth>5 时 X=5 ────────────────────
  it('P0(6血上限,0手牌) → X=5(封顶),摸5张', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    for (let i = 0; i < 8; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5', 'dk6', 'dk7'];

    const state: GameState = createGameState({
      players: [
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
          skills: ['界节命', '闪'],
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
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // X = min(6, 5) = 5,P0 摸 5 张,无弃
    expect(harness.state.players[0].hand.length).toBe(5);
  });

  // ─── 关键差异·先摸后弃:目标原有手牌时,先摸 X 张再弃至 X 张 ────────────
  it('P0(4血上限,已有3手牌) → 摸4张(7张) → 弃3张(回到4张)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    // P0 原有 3 张手牌
    const p0Cards = ['h1', 'h2', 'h3'];
    for (const id of p0Cards) cardMap[id] = makeCard(id, '闪', '♦', '2');
    // deck 供摸 4 张
    for (let i = 0; i < 5; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4'];

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
          skills: ['界节命', '闪'],
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
    state.players[0].hand = [...p0Cards, 'k1']; // P0 有杀+3张
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // P0 原 3 张(杀已出)→ 摸 4 张 → 7 张 → 需弃 3 张
    expect(harness.state.players[0].hand.length).toBe(7);

    // P0 被询问弃 3 张
    P0.expectPending('请求回应');
    const slot = [...harness.state.pendingSlots.values()][0];
    const atom = slot.atom as { requestType?: string };
    expect(atom.requestType).toBe('节命/discard');

    // P0 弃 3 张
    const toDiscard = harness.state.players[0].hand.slice(0, 3);
    await P0.respond('界节命', { cardIds: toDiscard });

    // P0 手牌 = 7 - 3 = 4 = X
    expect(harness.state.players[0].hand.length).toBe(4);
    // 弃牌堆含 3 张
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(toDiscard));
  });

  // ─── 不发动:拒绝 ────────────────────
  it('不发动节命:不摸不弃', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀', '闪'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['界节命', '闪'],
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
    await P1.respond('界节命', { choice: false });

    // P0 手牌不变(杀已出,0 手牌)
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 选自己:给界荀彧摸弃 ────────────────────
  it('选自己(P1) → P1 摸 X 张,若超 X 再弃至 X', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    // deck 供摸 3 张(X=3)
    for (let i = 0; i < 4; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3'];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['界节命', '闪'],
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
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 1 }); // 选自己

    // P1 摸 3 张(X = min(3, 5) = 3,当前 0 手牌)→ 无需弃
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 死亡时触发:界荀彧被杀致死 → 仍可发动节命 ────────────────────
  it('P1(界荀彧,1血)被杀致死 → 濒死求桃失败 → 死亡时触发节命 → 选 P0 摸弃', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    // deck 供 P0 摸 X 张
    for (let i = 0; i < 6; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5'];

    const state: GameState = createGameState({
      players: [
        // P0:4 血上限,0 手牌(X=4)
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀'] }),
        // P1:界荀彧 1 血(将被杀致死),3 血上限,0 手牌(否则死亡时进弃牌堆)
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['界节命', '闪'],
          health: 1,
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
    await P1.pass(); // 不出闪 → 濒死

    // 濒死求桃:P0 无桃可出,跳过
    await P0.pass();
    // P1 自己也无桃
    await P1.pass();

    // 击杀前:界节命触发
    P1.expectPending('请求回应');
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // P0 摸 4 张(X = min(4, 5) = 4),无需弃
    expect(harness.state.players[0].hand.length).toBe(4);

    // 荀彧 死亡
    expect(harness.state.players[1].alive).toBe(false);
  });

  // ─── 边界:目标手牌已 ≤ X,摸后仍 ≤ X 时不弃 ────────────────────
  it('P0(5血上限,0手牌) → 摸5张= X,无需弃', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    for (let i = 0; i < 6; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5'];

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '关羽',
          skills: ['杀', '闪'],
          health: 5,
          maxHealth: 5,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['界节命', '闪'],
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
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // P0 摸 5 张,正好 = X,无需弃
    expect(harness.state.players[0].hand.length).toBe(5);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 边界:目标 maxHealth < 5,X = maxHealth,先摸后弃 ────────────
  it('P0(3血上限,已有2手牌) → 摸3张(5张) → 弃2张(回到3张)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    const p0Cards = ['h1', 'h2'];
    for (const id of p0Cards) cardMap[id] = makeCard(id, '闪', '♦', '2');
    for (let i = 0; i < 4; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3'];

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '郭嘉',
          skills: ['杀', '闪'],
          hand: p0Cards,
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['界节命', '闪'],
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
    state.players[0].hand = [...p0Cards, 'k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // P0 原 2 张(杀已出)→ 摸 3 张 → 5 张 → 需弃 2 张(X=3)
    expect(harness.state.players[0].hand.length).toBe(5);
    P0.expectPending('请求回应');
    const toDiscard = harness.state.players[0].hand.slice(0, 2);
    await P0.respond('界节命', { cardIds: toDiscard });

    // P0 手牌 = 5 - 2 = 3 = X
    expect(harness.state.players[0].hand.length).toBe(3);
  });
});
