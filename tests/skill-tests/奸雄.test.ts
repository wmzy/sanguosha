// 奸雄(曹操·被动技)测试
//   标版奸雄:当你受到伤害后,你可以获得造成此伤害的牌。(官方逐字,无摸牌)
//   界奸雄(界曹操):当你受到伤害后,你可以摸一张牌,并获得造成此伤害的牌。
//     (两项效果,非二选一;无来源伤害时仍可发动,仅摸一张——官网 FAQ 2016-11-01)
//   获得伤害牌采用延迟拿取,避免父结算重复入弃牌堆;界版摸一张在询问后立即执行。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import { runDamageFlow } from '../../src/engine/flows/damage';
import { applyAtom } from '../../src/engine/core/apply';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { TARGET_SYSTEM } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
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
    character: '主公',
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
    faction: '魏',
    identity: '主公',
  };
}

describe('奸雄', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 获得伤害牌(杀),无摸牌(标版单效果) ─────────────────────
  it('P0 杀 P1(曹操) → P1 不闪 → 奸雄发动 → 仅获得杀牌,不摸牌(弃牌堆不重复)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const draw = makeCard('d1', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['s1'], skills: ['奸雄', '闪'], health: 4 }),
      ],
      cardMap: { k1: slash, s1: makeCard('s1', '闪', '♥', '2'), d1: draw },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 摸牌堆放一张:标版奸雄无摸牌段,d1 应留在牌堆
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪 → 扣血 → 奸雄询问
    P1.expectPending('请求回应');
    // 发动奸雄(choice=true)→ 仅获得伤害牌
    await P1.respond('奸雄', { choice: true });
    await harness.waitForStable();

    // 杀牌进入 P1 手牌
    expect(harness.state.players[1].hand).toContain('k1');
    // 标版无摸牌:d1 留在牌堆,手牌只有 s1 + k1
    expect(harness.state.players[1].hand).not.toContain('d1');
    expect(harness.state.players[1].hand).toHaveLength(2); // s1 + k1
    expect(harness.state.zones.deck).toEqual(['d1']);
    // 弃牌堆不含杀牌(被奸雄拿走,不重复)
    expect(harness.state.zones.discardPile).not.toContain('k1');
    // P1 受了 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 不发动:choice=false → 杀牌正常入弃牌堆,P1 不获得 ─────
  it('P0 杀 P1(曹操) → P1 不闪 → 奸雄选不发动 → 杀牌正常入弃牌堆,P1 不获得', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['s1'], skills: ['奸雄', '闪'], health: 4 }),
      ],
      cardMap: { k1: slash, s1: makeCard('s1', '闪', '♥', '2') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    P1.expectPending('请求回应');
    // 选不发动(choice=false)
    await P1.respond('奸雄', { choice: false });
    await harness.waitForStable();

    // P1 未获得杀牌
    expect(harness.state.players[1].hand).not.toContain('k1');
    // 杀牌正常入弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    // P1 受了 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 无来源伤害:技能不发动(无可获得之物) ─────────────────────
  it('无来源伤害(无 cardId)→ 奸雄不发动 → 无询问、无额外效果', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['奸雄'], health: 4 }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 无来源、无 cardId 的伤害(如闪电)
    void runDamageFlow(harness.state, TARGET_SYSTEM, 0, 1);
    await waitForStable(harness.state);
    // 无伤害牌 → 技能不发动,无询问 pending
    P0.expectNoPending();

    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand).toHaveLength(0);
  });

  // ─── respond validate:无 pending 拒绝 ─────────────────────────────
  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['奸雄'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    await P0.expectRejected({ skillId: '奸雄', actionType: 'respond', params: { choice: true } });
  });

  // ─── 回归:上一轮 wantCard 残留(伤害牌被截走未入弃牌堆)不得在后续误拿 ───
  it('上次伤害牌未入弃牌堆 → 下次不发动后该牌再入弃牌堆不被误拿', async () => {
    const k1 = makeCard('k1', '杀', '♠', '7');
    const k2 = makeCard('k2', '杀', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1', 'k2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['奸雄'], health: 4 }),
      ],
      cardMap: { k1, k2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次伤害:P1 发动奸雄想拿 k1,但 k1 被其他 hook 截走(模拟:始终未入弃牌堆)
    void runDamageFlow(harness.state, 0, 1, 1, 'k1');
    await waitForStable(harness.state);
    P1.expectPending('请求回应');
    await P1.respond('奸雄', { choice: true });
    await harness.waitForStable();
    // k1 从未进入弃牌堆 → wantCard 残留
    expect(harness.state.zones.discardPile).not.toContain('k1');

    // 第二次伤害:P1 不发动(choice=false)
    void runDamageFlow(harness.state, 0, 1, 1, 'k2');
    await waitForStable(harness.state);
    P1.expectPending('请求回应');
    await P1.respond('奸雄', { choice: false });
    await harness.waitForStable();

    // k1 后来被移入弃牌堆 → 修复后不得被误拿
    await applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'k1',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();

    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.players[1].hand).not.toContain('k1');
    expect(harness.state.players[1].hand).toHaveLength(0);
  });
});

// ─── 界奸雄(界曹操):摸一张牌,并获得造成此伤害的牌(两项,非二选一) ───
describe('界奸雄', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('P0 杀 P1(界曹操) → P1 不闪 → 发动 → 摸一张并获得杀牌(弃牌堆不重复)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const draw = makeCard('d1', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['s1'], skills: ['界奸雄', '闪'], health: 4 }),
      ],
      cardMap: { k1: slash, s1: makeCard('s1', '闪', '♥', '2'), d1: draw },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    P1.expectPending('请求回应');
    // 发动界奸雄 → 两项都执行:摸一张(d1) + 获得杀牌(k1)
    await P1.respond('界奸雄', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[1].hand).toContain('k1');
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.players[1].hand).toHaveLength(3); // s1 + k1 + d1
    expect(harness.state.zones.deck).toHaveLength(0);
    expect(harness.state.zones.discardPile).not.toContain('k1');
    expect(harness.state.players[1].health).toBe(3);
  });

  it('不发动(choice=false)→ 不摸牌不获得,杀牌正常入弃牌堆', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['界奸雄', '闪'], health: 4 }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 无手牌 → 询问闪被 preResolve skip,useCardAndTarget 返回时已推进到界奸雄询问;
    // 此处不可再 pass()(会把刚出现的界奸雄询问当超时烧掉)。
    await waitForStable(harness.state);
    P1.expectPending('请求回应');
    await P1.respond('界奸雄', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[1].hand).not.toContain('k1');
    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.players[1].health).toBe(3);
  });

  it('无来源伤害(闪电)→ 仍可发动,仅摸一张牌(官网 FAQ)', async () => {
    const draw = makeCard('d1', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界奸雄'], health: 4 }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { d1: draw },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void runDamageFlow(harness.state, TARGET_SYSTEM, 0, 1);
    await waitForStable(harness.state);
    // 无伤害牌仍有询问(可发动仅摸一张)
    P0.expectPending('请求回应');
    await P0.respond('界奸雄', { choice: true });
    await harness.waitForStable();

    // 仅摸一张(d1),无牌可获得
    expect(harness.state.players[0].hand).toEqual(['d1']);
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 回归:上一轮 wantCard 残留(伤害牌被截走未入弃牌堆)不得在后续误拿 ───
  it('上次伤害牌未入弃牌堆 → 下次不发动后该牌再入弃牌堆不被误拿', async () => {
    const k1 = makeCard('k1', '杀', '♠', '7');
    const k2 = makeCard('k2', '杀', '♣', '8');
    const d1 = makeCard('d1', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1', 'k2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['界奸雄'], health: 4 }),
      ],
      cardMap: { k1, k2, d1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次伤害:P1 发动界奸雄(摸一张 + 想拿 k1),但 k1 被截走(模拟:始终未入弃牌堆)
    void runDamageFlow(harness.state, 0, 1, 1, 'k1');
    await waitForStable(harness.state);
    P1.expectPending('请求回应');
    await P1.respond('界奸雄', { choice: true });
    await harness.waitForStable();
    // 摸了 d1;k1 从未进入弃牌堆 → wantCard 残留
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.zones.discardPile).not.toContain('k1');

    // 第二次伤害:P1 不发动(choice=false)
    void runDamageFlow(harness.state, 0, 1, 1, 'k2');
    await waitForStable(harness.state);
    P1.expectPending('请求回应');
    await P1.respond('界奸雄', { choice: false });
    await harness.waitForStable();

    // k1 后来被移入弃牌堆 → 修复后不得被误拿
    await applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'k1',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();

    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.players[1].hand).not.toContain('k1');
    expect(harness.state.players[1].hand).toEqual(['d1']);
  });
});
