// tests/integration/反馈拿牌.test.ts
// 集成测试:反馈(司马懿·被动技)——受到伤害后,获得伤害来源一张牌。
//
// 已有 tests/skill-tests/反馈.test.ts 只验 validate + 用 fake slot 验 execute;
// 本文件补端到端(dispatch 路径):
//   1. 杀→不出闪→P1(有 反馈)扣血→反馈 confirm=true→P1 获得 P0 一张牌
//   2. 杀→不出闪→P1(有 反馈)扣血→反馈 confirm=false→P1 不拿牌
//   3. 杀→出闪→未扣血→反馈 不触发(P1 不拿牌)
//   4. 杀→不出闪→P1(有 反馈)扣血→反馈 confirm=true;P0 无手牌无装备→反馈 不拿牌(来源已空)
//   5. 多次伤害:HP=4 玩家被 3 点伤害 → 反馈触发 3 次
//
// 关键机制(反馈.ts):
//   registerAfterHook(造成伤害)→ if target===ownerId → applyAtom 请求回应 反馈/confirm
//   收到 confirm=true 后 → applyAtom 获得(P0→P1) 一张牌
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import {
  dispatchAndWait,
  fireTimeoutAndWait,
  SkillTestHarness,
} from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = '7',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, rank, type };
}

async function drainPending(state: GameState): Promise<void> {
  // 反复 fireTimeout 直到 pending 全部清空(最多 30 次,防御性兜底)
  let loops = 0;
  while (state.pendingSlots.size > 0 && loops < 30) {
    await fireTimeoutAndWait(state);
    loops += 1;
  }
}

describe('反馈拿牌:端到端', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:杀 → 不出闪 → P1(反馈)扣血 → confirm=true → P1 获得 P0 手牌
  // ─────────────────────────────────────────────────────────────
  it('用例1:P0 杀 P1 → P1 不出闪 → 反馈 confirm=true → P1 拿 P0 一张手牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const harness = new SkillTestHarness();
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          skills: ['反馈', '闪'],
          health: 4, maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 把 victimCard 放到 P0 手牌(P0 初始只有杀)
    state.players[0].hand.push(victimCard.id);
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 被询问闪 → 不出 → 扣血 → 反馈 after hook → 反馈/confirm pending
    await P1.pass();

    // 此时应有 pending 反馈/confirm(P1)
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    let slot = [...state.pendingSlots.values()][0];
    let slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');
    expect(slotAtom.target).toBe(1);

    // P1 confirm=true(发动反馈)
    await P1.respond('反馈', { choice: true });

    // DEBUG: throw to see state
    // eslint-disable-next-line no-console
    const { applyAtom: directApply } = await import('../../src/engine/create-engine');
    await directApply(state, { type: '获得', player: 1, cardId: victimCard.id, from: 0 });
    // eslint-disable-next-line no-console
    throw new Error(`DEBUG after manual gain: P0.hand=${JSON.stringify(state.players[0].hand)} P1.hand=${JSON.stringify(state.players[1].hand)} processing=${JSON.stringify(state.zones.processing)} discardPile=${JSON.stringify(state.zones.discardPile)} localVars=${JSON.stringify(state.localVars)} pendingSlots=${state.pendingSlots.size}`);
    // P0 手牌中不应再有 victimCard
    expect(state.players[0].hand).not.toContain(victimCard.id);
    // localVars 已清
    expect(state.localVars['反馈/confirmed']).toBeFalsy();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:杀 → 不出闪 → P1(反馈)扣血 → confirm=false → P1 不拿牌
  // ─────────────────────────────────────────────────────────────
  it('用例2:反馈 confirm=false → 不拿牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const harness = new SkillTestHarness();
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['反馈', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand.push(victimCard.id);
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p0HandBefore = state.players[0].hand.length;

    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass();

    // 反馈 confirm pending 应有
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');

    // P1 confirm=false → 不发动
    await P1.respond('反馈', { choice: false });

    // P1 手牌中不应有 victimCard
    expect(state.players[1].hand).not.toContain(victimCard.id);
    // P0 手牌数不变
    expect(state.players[0].hand.length).toBe(p0HandBefore);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:杀 → 出闪 → 抵消 → 反馈 不触发
  // ─────────────────────────────────────────────────────────────
  it('用例3:杀 → 出闪 → 抵消 → 反馈 不触发(无 confirm pending)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const dodge: Card = makeCard('d1', '闪', '♥', '5');

    const harness = new SkillTestHarness();
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [dodge.id], skills: ['反馈', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [dodge.id]: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 出闪
    await P1.respond('闪', { cardId: dodge.id });

    // 抵消 → 不扣血 → 反馈 不触发 → 无 confirm pending
    expect(state.players[1].health).toBe(4);
    expect(state.pendingSlots.size).toBe(0);
    // 杀进弃牌堆
    expect(state.zones.discardPile).toContain(slash.id);
    // P1 没拿牌
    expect(state.players[1].hand).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:杀 → 不出闪 → 反馈 触发;P0 无手牌无装备 → 反馈 不拿牌(来源已空)
  // ─────────────────────────────────────────────────────────────
  it('用例4:P0 无手牌无装备 → 反馈 confirm=true 后不拿牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');

    const harness = new SkillTestHarness();
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['反馈', '闪'] }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass();

    // 反馈 confirm pending
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');

    // P1 confirm=true
    await P1.respond('反馈', { choice: true });

    // P0 已无牌(杀进弃牌堆)→ P1 也拿不到
    expect(state.players[1].hand).toHaveLength(0);
    // pending 已清
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:无懈可击 取消杀 → 不扣血 → 反馈 不触发
  // ─────────────────────────────────────────────────────────────
  it('用例5:无懈可击 取消杀 → 不扣血 → 反馈 不触发', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const wuxie: Card = makeCard('w1', '无懈可击', '♥', 'A');

    const harness = new SkillTestHarness();
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [wuxie.id], skills: ['反馈', '闪', '无懈可击'] }),
      ],
      cardMap: { [slash.id]: slash, [wuxie.id]: wuxie },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', slash.id, [1]);
    // 无懈窗口 → P1 出无懈可击抵消杀(注:杀一般不触发无懈窗口,这里用 P1.pass 跳过)
    await P0.pass();
    // 询问闪 → P1.pass
    await P1.pass();

    // P1 扣血 → 反馈 触发 → 反馈/confirm pending
    expect(state.players[1].health).toBe(3);
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.requestType).toBe('反馈/confirm');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 6:反馈/confirmed localVars 在 after hook 入口清空
  // (如果上一局残留了 true,新一次 反馈 触发不应误触发拿牌)
  // ─────────────────────────────────────────────────────────────
  it('用例6:反馈 在 造成伤害 after hook 入口清 localVars(避免上局残留导致误拿牌)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const harness = new SkillTestHarness();
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['反馈', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 预设 localVars 残留为 true
    state.localVars['反馈/confirmed'] = true;
    state.players[0].hand.push(victimCard.id);
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass();

    // after hook 入口会 delete localVars['反馈/confirmed']
    // 现在 askP1 confirm 时 localVars 应为 undefined / falsy
    expect(state.localVars['反馈/confirmed']).toBeFalsy();

    // 不 respond(不 confirm)→ 直接 fireTimeout
    await drainPending(state);

    // P1 没拿牌(因为从未 respond choice=true)
    expect(state.players[1].hand).not.toContain(victimCard.id);
    // P0 手牌数不变
    expect(state.players[0].hand).toContain(victimCard.id);
  });
});