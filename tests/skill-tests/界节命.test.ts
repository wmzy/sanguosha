// tests/skill-tests/界节命.test.ts
// 界节命(界荀彧·被动技) OL 官方逐字:
//   "当你受到1点伤害后或死亡时,你可以令一名角色摸X张牌,然后将手牌弃至X张
//    (X为其体力上限且至多为5)。"
//
// 触发机制(对齐实现 src/engine/skills/界节命.ts):
//   - 受到伤害后(after-hook,时机6,濒死检查之后):非致死 或 致死被救活时触发,
//     并置「伤害已触发」标记;若随后荀彧死亡,死亡时 hook 见标记去重跳过。
//   - 死亡时(after-hook,系统处理牌前):伤害致死(濒死检查先执行,荀彧已亡,
//     受到伤害后因 !alive 跳过)或 非伤害致死(失去体力/减上限等)在此触发。
//
// 与标版节命关键差异(必须验证):
//   1. 受伤后触发:先摸 X 张,然后弃至 X 张(非「摸至 X 张」)
//   2. 致死触发:伤害致死经 受到伤害后 触发(死亡时去重);非伤害致死经 死亡时 触发(标版无)
//   3. 无额外摸牌(标版旧实现「若目标原手牌为0,你摸一张牌」已移除)
//
// 验证:
//   1. 受伤 happy path:0手牌目标 → 摸 X 张,无需弃
//   2. X 封顶 5:maxHealth>5 时 X=5
//   3. 关键差异·先摸后弃:目标原有 N 手牌 → 摸 X 张 → 弃至 X 张
//   4. 不发动:拒绝
//   5. 选自己:给自己摸弃
//   6. 伤害致死:被杀致死 → 受到伤害后触发(死亡时去重跳过)→ 选目标摸弃,荀彧仍死亡
//   7. 目标手牌已 ≤ X:摸后超 X 才弃,不超不弃(maxHealth 正好=5)
//   8. 非伤害致死:失去体力致死 → 死亡时触发 → 选目标摸弃
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, fireTimeoutAndWait } from '../engine-harness';
import { applyAtom } from '../../src/engine/index';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
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
    // P1 0 手牌 → 询问闪 skip → 直接受伤

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
    // P1 0 手牌 → 询问闪 skip → 直接受伤

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
    // P1 0 手牌 → 询问闪 skip → 直接受伤

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
    expect(atom.requestType).toBe('界节命/discard');

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
    // P1 0 手牌 → 询问闪 skip → 直接受伤

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
    // P1 0 手牌 → 询问闪 skip → 直接受伤

    P1.expectPending('请求回应');
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 1 }); // 选自己

    // P1 摸 3 张(X = min(3, 5) = 3,当前 0 手牌)→ 无需弃
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 伤害致死:被杀致死 → 受到伤害后触发节命(死亡时去重跳过)────
  it('P1(界荀彧,1血)被杀致死 → 死亡时触发节命(濒死先于受到伤害后)→ 选 P0 摸弃 → P1仍死亡', async () => {
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
    // P1 0 手牌 → 询问闪 skip → 受 1 点伤害(1→0)→ 扣减体力后濒死检查(先于 受到伤害后)
    // 濒死求桃无人救 → 死亡 → 死亡时 hook 触发节命(受到伤害后因 !alive 跳过)
    P1.expectPending('请求回应');
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // 节命结算后继续:濒死检查 → 求桃(无人有桃)→ 死亡;
    // 节命由 死亡时 hook 触发;死亡后 受到伤害后 hook 因 !alive 跳过(不重复触发)
    await fireTimeoutAndWait(harness.state);
    await harness.waitForStable();
    harness.processAllEvents();

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
    // P1 0 手牌 → 询问闪 skip → 直接受伤

    P1.expectPending('请求回应');
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // P0 摸 5 张,正好 = X,无需弃
    expect(harness.state.players[0].hand.length).toBe(5);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 非伤害致死:失去体力致死 → 死亡时 after-hook 触发节命 ──────────
  it('P1(界荀彧,1血)失去体力致死 → 求桃失败 → 死亡时触发节命 → 选 P0 摸弃', async () => {
    // 失去体力不经 造成伤害/受到伤害后,故「伤害已触发」标记未置,节命由死亡时 after-hook 触发
    const cardMap: Record<string, Card> = {};
    for (let i = 0; i < 6; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5'];

    const state: GameState = createGameState({
      players: [
        // P0:4 血上限,0 手牌(X=4),无桃 → 求桃失败
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀'] }),
        // P1:界荀彧 1 血(将失体力致死),3 血上限,0 手牌
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
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 失去 1 点体力致死(非伤害:不经 受到伤害后,死亡时标记未置)
    void applyAtom(harness.state, { type: '失去体力', target: 1, amount: 1 });
    await harness.waitForStable();

    // 排干 求桃流程(P1/P0 均无桃),直到节命 confirm 出现
    while (harness.state.pendingSlots.size > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const rt = (slot.atom as { requestType?: string }).requestType;
      if (rt === '界节命/confirm') break;
      const target = (slot.atom as { target?: number }).target ?? 0;
      await harness.player(target).pass();
      await harness.waitForStable();
    }

    // 死亡时 after-hook 触发节命(P1 此刻仍 alive,系统处理牌在其后)
    P1.expectPending('请求回应');
    await P1.respond('界节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界节命', { target: 0 });

    // 节命结算后死亡流程继续:系统处理牌 → P1 alive=false
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 摸 4 张(X = min(4, 5) = 4),无需弃
    expect(harness.state.players[0].hand.length).toBe(4);
    // 荀彧 死亡
    expect(harness.state.players[1].alive).toBe(false);
  });
});
