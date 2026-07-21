// tests/skill-tests/界忘隙.test.ts
// 界忘隙(界李典·被动技):当你对其他角色造成1点伤害后,
// 或受到其他角色的1点伤害后,你可以摸两张牌并交给该角色其中一张牌。
//
// 官方来源:三国杀 OL 界限突破 hero/317。
//
// 两种触发情形(每 1 点伤害触发一次):
//   A. owner 造成伤害给其他角色(source=owner,target=他人)→ 该角色=target
//   B. owner 受到其他角色伤害(target=owner,source=他人)→ 该角色=source
//   自伤(source===target===owner)不触发。
//
// 验证:
//   1. respond validate:无 pending → 拒绝
//   2. respond validate:PICK 下未选/选 2 张/选候选范围外 → 拒绝
//   3. respond execute:CONFIRM choice=true → 写入 localVars
//   4. 端到端(情形 B):P0 杀 P1 → P1 confirm → 摸2张 → 选1张给P0
//   5. 端到端(情形 A):P0(忘隙) 杀 P1 → P0 confirm → 摸2张 → 选1张给P1
//   6. 端到端:confirm=false → 不摸牌
//   7. 端到端:自伤(界强袭 source===target===owner)→ 不触发忘隙
//   8. 端到端:2 点伤害触发两次
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
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
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

/** 直接向 state 注入一个 fake 请求回应 pending(单元测试 validate 用)。 */
function injectPending(state: GameState, idx: number, requestType: string, prompt: unknown): void {
  state.pendingSlots.set(idx, {
    atom: {
      type: '请求回应',
      requestType,
      target: idx,
      prompt: prompt as never,
    },
    definition: undefined as never,
    startTime: 0,
    deadline: 100000,
    createdSeq: 0,
    isBlocking: true,
    resolve: () => {},
    isTimeout: false,
    isPaused: false,
    pause() {},
    _fireTimeoutNow: undefined,
  });
}

describe('界忘隙', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界忘隙'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界忘隙',
      actionType: 'respond',
      params: { choice: true },
    });
  });

  it('respond:PICK 下选 0 张 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['a', 'b'], skills: ['界忘隙'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { a: makeCard('a', '杀'), b: makeCard('b', '杀') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '忘隙/pick', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b'],
      minTotal: 1,
      maxTotal: 1,
    });

    await P1.expectRejected({
      skillId: '界忘隙',
      actionType: 'respond',
      params: { cardIds: [] },
    });
  });

  it('respond:PICK 下选 2 张 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['a', 'b'], skills: ['界忘隙'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { a: makeCard('a', '杀'), b: makeCard('b', '杀') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '忘隙/pick', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b'],
      minTotal: 1,
      maxTotal: 1,
    });

    await P1.expectRejected({
      skillId: '界忘隙',
      actionType: 'respond',
      params: { cardIds: ['a', 'b'] },
    });
  });

  it('respond:PICK 下选候选范围外 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['a', 'b', 'c'], skills: ['界忘隙'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀'),
        b: makeCard('b', '杀'),
        c: makeCard('c', '杀'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 候选范围只有 a, b
    injectPending(state, 0, '忘隙/pick', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b'],
      minTotal: 1,
      maxTotal: 1,
    });

    // 选 c(不在候选范围)→ 拒绝
    await P1.expectRejected({
      skillId: '界忘隙',
      actionType: 'respond',
      params: { cardIds: ['c'] },
    });
  });

  // ─── respond execute ─────────────────────────

  it('respond:CONFIRM choice=true 写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界忘隙'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '忘隙/confirm', { type: 'confirm', title: '是否发动?' });

    await P1.expectAccepted({
      skillId: '界忘隙',
      actionType: 'respond',
      params: { choice: true },
    });
    await harness.waitForStable();
    expect(state.localVars['忘隙/confirmed']).toBe(true);
  });

  it('respond:PICK 合法选择写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['a', 'b'], skills: ['界忘隙'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { a: makeCard('a', '杀'), b: makeCard('b', '杀') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '忘隙/pick', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b'],
      minTotal: 1,
      maxTotal: 1,
    });

    await P1.expectAccepted({
      skillId: '界忘隙',
      actionType: 'respond',
      params: { cardIds: ['a'] },
    });
    await harness.waitForStable();
    expect(state.localVars['忘隙/pickChoice']).toBe('a');
  });

  // ─── 端到端 ─────────────────────────────────

  it('端到端(情形 B):P0 杀 P1 → P1 confirm → 摸2张 → 选1张给 P0', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '闪', '♦', '4');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界忘隙', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, g1: drawn1, g2: drawn2 },
      zones: { deck: ['g1', 'g2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 不闪
    await P1.pass();

    // 询问是否发动忘隙
    P1.expectPending('请求回应');
    const cslot = [...harness.state.pendingSlots.values()][0];
    const cAtom = cslot.atom as { requestType?: string; target?: number };
    expect(cAtom.requestType).toBe('忘隙/confirm');
    expect(cAtom.target).toBe(1);

    await P1.respond('界忘隙', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 摸了 2 张牌
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['g1', 'g2']));
    expect(harness.state.players[1].hand).toHaveLength(2);

    // 询问选 1 张给 P0
    P1.expectPending('请求回应');
    const pslot = [...harness.state.pendingSlots.values()][0];
    const pAtom = pslot.atom as {
      requestType?: string;
      prompt?: { cardIds?: string[] };
    };
    expect(pAtom.requestType).toBe('忘隙/pick');
    expect(pAtom.prompt?.cardIds).toEqual(expect.arrayContaining(['g1', 'g2']));

    // P1 选 g1 给 P0
    await P1.respond('界忘隙', { cardIds: ['g1'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 保留 g2;P0 收到 g1
    expect(harness.state.players[1].hand).toEqual(['g2']);
    expect(harness.state.players[0].hand).toContain('g1');
  });

  it('端到端(情形 A):P0(忘隙) 杀 P1 → P0 confirm → 摸2张 → 选1张给 P1', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '闪', '♦', '4');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['杀', '界忘隙'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { k1: slash, g1: drawn1, g2: drawn2 },
      zones: { deck: ['g1', 'g2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 不闪
    await P1.pass();

    // 询问 P0 是否发动忘隙(情形 A:P0 是伤害来源,该角色=P1)
    P0.expectPending('请求回应');
    const cslot = [...harness.state.pendingSlots.values()][0];
    const cAtom = cslot.atom as { requestType?: string; target?: number };
    expect(cAtom.requestType).toBe('忘隙/confirm');
    expect(cAtom.target).toBe(0);

    await P0.respond('界忘隙', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 摸了 2 张
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['g1', 'g2']));
    expect(harness.state.players[0].hand.filter((c) => c === 'g1' || c === 'g2')).toHaveLength(2);

    // 选 1 张给 P1
    P0.expectPending('请求回应');
    await P0.respond('界忘隙', { cardIds: ['g1'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 留 g2;P1 收到 g1
    expect(harness.state.players[0].hand).toContain('g2');
    expect(harness.state.players[0].hand).not.toContain('g1');
    expect(harness.state.players[1].hand).toContain('g1');
  });

  it('端到端:confirm=false → 不摸牌,不给牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '闪', '♦', '4');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界忘隙', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, g1: drawn1, g2: drawn2 },
      zones: { deck: ['g1', 'g2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 询问忘隙 → 选择不发动
    P1.expectPending('请求回应');
    await P1.respond('界忘隙', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无后续询问;P1 手牌仍为空;P0 未收到牌
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.players[0].hand).not.toContain('g1');
    expect(harness.state.players[0].hand).not.toContain('g2');
    // 牌堆未动
    expect(harness.state.zones.deck).toEqual(['g1', 'g2']);
  });

  it('端到端:自伤(source===target===owner)→ 不触发忘隙', async () => {
    // 用界强袭的自伤代价测试:界强袭 受到1点伤害 对他人造成1点伤害
    // 自伤部分 source=target=ownerId → 忘隙不应触发
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '闪', '♦', '4');
    const drawn3: Card = makeCard('g3', '杀', '♠', '5');
    const drawn4: Card = makeCard('g4', '闪', '♣', '6');

    const state: GameState = createGameState({
      players: [
        // P0 同时拥有界强袭和界忘隙;界强袭自伤触发时,忘隙不应触发
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界强袭', '界忘隙'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['杀'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { g1: drawn1, g2: drawn2, g3: drawn3, g4: drawn4 },
      zones: { deck: ['g1', 'g2', 'g3', 'g4'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P0 发动界强袭,选 cost=damage(自伤1点)+ target=P1
    await P0.triggerAction('界强袭', 'use', { cost: 'damage', target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 强袭对 P1 造成 1 点伤害 → P0 是 source,P1 是 target → 忘隙触发(情形 A)
    // 应该看到忘隙/confirm 询问
    P0.expectPending('请求回应');
    const slot = [...harness.state.pendingSlots.values()][0];
    const atom = slot.atom as { requestType?: string };
    expect(atom.requestType).toBe('忘隙/confirm');

    // 关键:只有一次忘隙询问(来自对 P1 的伤害),自伤那次被过滤掉
    // 选择不发动以快速结束
    await P0.respond('界忘隙', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无更多忘隙询问(自伤那次确实没触发)
    expect(harness.state.pendingSlots.size).toBe(0);
    // 没摸牌
    expect(harness.state.players[0].hand).toEqual([]);
  });

  it('端到端:2 点伤害 → 触发两次忘隙', async () => {
    // 用 酒 + 杀 制造 2 点伤害(酒使下一杀+1)
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const wine: Card = makeCard('w1', '酒', '♦', '5');
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '闪', '♦', '4');
    const drawn3: Card = makeCard('g3', '杀', '♠', '8');
    const drawn4: Card = makeCard('g4', '闪', '♣', '6');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1', 'k1'],
          skills: ['酒', '杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界忘隙', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, w1: wine, g1: drawn1, g2: drawn2, g3: drawn3, g4: drawn4 },
      zones: { deck: ['g1', 'g2', 'g3', 'g4'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 先喝酒
    await P0.useCard('酒', 'w1');
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 出杀(酒加成,伤害=2)
    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 不闪
    await P1.pass();
    await harness.waitForStable();
    harness.processAllEvents();

    // 第一次忘隙(1点伤害)
    P1.expectPending('请求回应');
    let slot = [...harness.state.pendingSlots.values()][0];
    let atom = slot.atom as { requestType?: string; prompt?: { cardIds?: string[] } };
    expect(atom.requestType).toBe('忘隙/confirm');

    // 第一次:发动
    await P1.respond('界忘隙', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 第一次:选牌给 P0
    P1.expectPending('请求回应');
    slot = [...harness.state.pendingSlots.values()][0];
    atom = slot.atom as { requestType?: string; prompt?: { cardIds?: string[] } };
    expect(atom.requestType).toBe('忘隙/pick');
    const firstDrawn = atom.prompt!.cardIds!;
    expect(firstDrawn).toHaveLength(2);
    // 选第一张给 P0
    await P1.respond('界忘隙', { cardIds: [firstDrawn[0]] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 第二次忘隙(2点伤害,第二次触发)
    P1.expectPending('请求回应');
    slot = [...harness.state.pendingSlots.values()][0];
    atom = slot.atom as { requestType?: string };
    expect(atom.requestType).toBe('忘隙/confirm');

    // 第二次:不发动(快速结束)
    await P1.respond('界忘隙', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无更多询问
    expect(harness.state.pendingSlots.size).toBe(0);
    // P1 第一次摸 2 张,给了 P0 1 张,保留 1 张;第二次没发动所以没摸牌
    expect(harness.state.players[1].hand).toHaveLength(1);
    // P0 收到 1 张
    expect(harness.state.players[0].hand).toContain(firstDrawn[0]);
  });
});
