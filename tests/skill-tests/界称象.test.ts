// tests/skill-tests/界称象.test.ts
// 界称象(界曹冲·被动技):当你受到1点伤害后,你可以亮出牌堆顶四张牌,
// 获得其中任意张点数和不大于13的牌;若获得的牌点数和恰好为13,
// 你下次发动"称象"多亮出一张牌。
//
// 官方来源:三国杀 OL 界限突破 hero/628。
//
// 验证:
//   1. respond validate:无 pending → 拒绝
//   2. respond validate:SELECT pending 下选牌点数和>13 → 拒绝
//   3. respond validate:SELECT pending 下选非候选牌 → 拒绝
//   4. respond execute:CONFIRM pending → choice 写入 localVars
//   5. 端到端:P0 杀 P1(1伤害) → P1 confirm → 选1张 → 入手牌,剩余留牌堆
//   6. 端到端:confirm=false → 不亮牌不取牌
//   7. 端到端:点数和恰好=13 → 设 bonus=1(下次发动亮5张)
//   8. 端到端:bonus=1 时亮5张(预设 vars)
//   9. 端到端:2点伤害触发两次
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
  vars?: Record<string, unknown>;
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
    vars: (opts.vars ?? {}) as Record<string, never>,
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

/** 直接向 state 注入一个 fake 请求回应 pending(单元测试 validate/execute 用)。 */
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

describe('界称象', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界称象'] }),
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
      skillId: '界称象',
      actionType: 'respond',
      params: { choice: true },
    });
  });

  it('respond:SELECT 下选牌点数和>13 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界称象'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀', '♠', '8'),
        b: makeCard('b', '杀', '♥', '7'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '称象/select', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b'],
    });

    // 8 + 7 = 15 > 13 → 拒绝
    await P1.expectRejected({
      skillId: '界称象',
      actionType: 'respond',
      params: { cardIds: ['a', 'b'] },
    });
  });

  it('respond:SELECT 下选非候选牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界称象'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀', '♠', '2'),
        b: makeCard('b', '杀', '♥', '2'),
        c: makeCard('c', '杀', '♣', '2'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '称象/select', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b'], // 候选只有 a,b
    });

    // c 不在候选 → 拒绝
    await P1.expectRejected({
      skillId: '界称象',
      actionType: 'respond',
      params: { cardIds: ['c'] },
    });
  });

  // ─── respond execute ─────────────────────────

  it('respond:CONFIRM 下 choice=true 写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界称象'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '称象/confirm', { type: 'confirm', title: '是否发动?' });

    await P1.expectAccepted({
      skillId: '界称象',
      actionType: 'respond',
      params: { choice: true },
    });
    await harness.waitForStable();
    expect(state.localVars['称象/confirmed']).toBe(true);
  });

  it('respond:SELECT 下合法选择写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界称象'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀', '♠', '8'),
        b: makeCard('b', '杀', '♥', '2'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '称象/select', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b'],
    });

    // 8 单张 ≤13 → 合法
    await P1.expectAccepted({
      skillId: '界称象',
      actionType: 'respond',
      params: { cardIds: ['a'] },
    });
    await harness.waitForStable();
    expect(state.localVars['称象/selection']).toEqual(['a']);
  });

  // ─── 端到端 ─────────────────────────────────

  it('端到端:P0 杀 P1(1伤害) → P1 confirm → 选1张 → 入手牌,剩余留牌堆', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    // 牌堆顶4张(deck 末尾为顶):d4(顶)=8点, d3=2点, d2=2点, d1(底)=5点
    const d1: Card = makeCard('d1', '杀', '♠', '5');
    const d2: Card = makeCard('d2', '闪', '♥', '2');
    const d3: Card = makeCard('d3', '桃', '♦', '2');
    const d4: Card = makeCard('d4', '杀', '♣', '8');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界称象', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, d1, d2, d3, d4 },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 不出闪
    await P1.pass();

    // 询问是否发动称象
    P1.expectPending('请求回应');
    const cslot = [...harness.state.pendingSlots.values()][0];
    const cAtom = cslot.atom as { requestType?: string; target?: number };
    expect(cAtom.requestType).toBe('称象/confirm');
    expect(cAtom.target).toBe(1);

    // P1 确认发动
    await P1.respond('界称象', { choice: true });

    // 询问选牌
    P1.expectPending('请求回应');
    const sslot = [...harness.state.pendingSlots.values()][0];
    const sAtom = sslot.atom as {
      requestType?: string;
      prompt?: { cardIds?: string[] };
    };
    expect(sAtom.requestType).toBe('称象/select');
    expect(sAtom.prompt?.cardIds).toEqual(['d4', 'd3', 'd2', 'd1']); // top→bottom

    // P1 选 d3(2点)和 d2(2点),共4点 ≤13
    await P1.respond('界称象', { cardIds: ['d3', 'd2'] });

    // P1 持有 d3,d2;d4,d1 仍在牌堆原位
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['d3', 'd2']));
    expect(harness.state.players[1].hand).toHaveLength(2);
    // 牌堆剩余:d4(顶), d1(底)(d3, d2 被取走,顺序保持)
    expect(harness.state.zones.deck).toEqual(['d1', 'd4']);
    // 无 bonus(本次和=4≠13)
    expect(harness.state.players[1].vars['称象/bonus']).toBeUndefined();
  });

  it('端到端:confirm=false → 不取牌,牌堆不变', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const d1: Card = makeCard('d1', '杀', '♠', '5');
    const d2: Card = makeCard('d2', '闪', '♥', '2');
    const d3: Card = makeCard('d3', '桃', '♦', '2');
    const d4: Card = makeCard('d4', '杀', '♣', '8');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界称象', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, d1, d2, d3, d4 },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 询问是否发动称象 → 选择不发动
    P1.expectPending('请求回应');
    await P1.respond('界称象', { choice: false });

    // 无后续询问;P1 无牌;牌堆完整
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['d1', 'd2', 'd3', 'd4']);
  });

  it('端到端:点数和恰好=13 → 设 bonus=1', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    // 顶4张:K(13) + 10
    const d1: Card = makeCard('d1', '杀', '♠', '1'); // 牌堆底
    const d2: Card = makeCard('d2', '闪', '♥', '1');
    const d3: Card = makeCard('d3', '杀', '♦', '10'); // 10点
    const d4: Card = makeCard('d4', '杀', '♣', 'K'); // 13点

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界称象', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, d1, d2, d3, d4 },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    await P1.respond('界称象', { choice: true });

    // 选 d3(10) + d4(K=13) = 23 >13 → 必须重新组合。
    // 改选只 d4(K=13) 单张,和=13 → bonus=1
    await P1.respond('界称象', { cardIds: ['d4'] });

    expect(harness.state.players[1].hand).toContain('d4');
    expect(harness.state.players[1].vars['称象/bonus']).toBe(1);
    // 牌堆剩 d1, d2, d3(d4 被取走)
    expect(harness.state.zones.deck).toEqual(['d1', 'd2', 'd3']);
  });

  it('端到端:bonus=1 时亮5张', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const d1: Card = makeCard('d1', '杀', '♠', '1');
    const d2: Card = makeCard('d2', '闪', '♥', '1');
    const d3: Card = makeCard('d3', '杀', '♦', '1');
    const d4: Card = makeCard('d4', '杀', '♣', '1');
    const d5: Card = makeCard('d5', '桃', '♠', '2');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界称象', '闪'],
          health: 4,
          maxHealth: 4,
          vars: { '称象/bonus': 1 },
        }),
      ],
      cardMap: { k1: slash, d1, d2, d3, d4, d5 },
      zones: { deck: ['d1', 'd2', 'd3', 'd4', 'd5'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 询问是否发动 → 确认
    P1.expectPending('请求回应');
    await P1.respond('界称象', { choice: true });

    // 询问选牌 → 应亮出 5 张(4+1 bonus)
    P1.expectPending('请求回应');
    const sslot = [...harness.state.pendingSlots.values()][0];
    const sAtom = sslot.atom as {
      requestType?: string;
      prompt?: { cardIds?: string[] };
    };
    expect(sAtom.requestType).toBe('称象/select');
    expect(sAtom.prompt?.cardIds).toHaveLength(5);
    expect(sAtom.prompt?.cardIds).toEqual(['d5', 'd4', 'd3', 'd2', 'd1']); // top→bottom

    // 选 d5(2点)单张
    await P1.respond('界称象', { cardIds: ['d5'] });

    expect(harness.state.players[1].hand).toContain('d5');
    // bonus 在发动时被消费(本次未 =13 → 不再设)
    expect(harness.state.players[1].vars['称象/bonus']).toBeUndefined();
  });

  it('端到端:2点伤害触发两次称象(酒+杀)', async () => {
    // P0 使用酒(下一张杀伤害+1)后再出杀 → 一次造成 2 点伤害 → 称象连触发两次
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const wine: Card = makeCard('w1', '酒', '♥', '3');
    // 牌堆初状:d1(底) .. d8(顶)
    const d1: Card = makeCard('d1', '杀', '♠', '1');
    const d2: Card = makeCard('d2', '杀', '♥', '1');
    const d3: Card = makeCard('d3', '杀', '♦', '1');
    const d4: Card = makeCard('d4', '杀', '♣', '1');
    const d5: Card = makeCard('d5', '杀', '♠', '2');
    const d6: Card = makeCard('d6', '杀', '♥', '2');
    const d7: Card = makeCard('d7', '杀', '♦', '2');
    const d8: Card = makeCard('d8', '杀', '♣', '2');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1', 'k1'],
          skills: ['杀', '酒'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界称象', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, w1: wine, d1, d2, d3, d4, d5, d6, d7, d8 },
      zones: {
        deck: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'],
        processing: [],
        discardPile: [],
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 使用酒(下一张杀伤害+1)
    await P0.useCard('酒', 'w1');

    // P0 出杀(伤害+1=2点)
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // P1 不闪

    // 期望 P1 受 2 点伤害 → health=2,称象触发两次
    expect(harness.state.players[1].health).toBe(2);

    // 第一次称象 confirm
    P1.expectPending('请求回应');
    await P1.respond('界称象', { choice: true });
    P1.expectPending('请求回应');
    const sslot1 = [...harness.state.pendingSlots.values()][0];
    const sAtom1 = sslot1.atom as { prompt?: { cardIds?: string[] } };
    expect(sAtom1.prompt?.cardIds).toEqual(['d8', 'd7', 'd6', 'd5']); // top→bottom
    await P1.respond('界称象', { cardIds: ['d8'] });

    // 第二次称象 confirm
    P1.expectPending('请求回应');
    await P1.respond('界称象', { choice: true });
    P1.expectPending('请求回应');
    const sslot2 = [...harness.state.pendingSlots.values()][0];
    const sAtom2 = sslot2.atom as { prompt?: { cardIds?: string[] } };
    // 第二次亮出新顶 4:d7 d6 d5 d4(d8 已被取走)
    expect(sAtom2.prompt?.cardIds).toEqual(['d7', 'd6', 'd5', 'd4']);
    await P1.respond('界称象', { cardIds: ['d7'] });

    // P1 共持 d8, d7;health=2
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['d8', 'd7']));
    expect(harness.state.players[1].hand).toHaveLength(2);
  });
});
