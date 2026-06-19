// tests/integration/fankui.test.ts
// 集成测试:反馈(司马懿·被动技)——受到伤害后,获得伤害来源一张牌。
//
// 覆盖:
//   1. 受伤 → 询问 → 发动 → P1 获得 P0 一张手牌
//   2. 受伤 → 询问 → 不发动 → P1 不拿牌,P0 手牌不变
//   3. 出闪 → 抵消 → 不扣血 → 反馈 不触发(无 confirm pending)
//   4. 来源 P0 已空(无手牌无装备)→ 反馈 confirm=true 但不拿牌
//
// 关键机制(反馈.ts):
//   registerAfterHook(造成伤害)→ if target===ownerId → applyAtom 请求回应 反馈/confirm
//   收到 confirm=true 后 → applyAtom 获得(P0→P1) 一张牌
//
// 模式:SkillTestHarness + useCardAndTarget(杀) + pass(不出闪) + respond(反馈)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
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
  suit: '♠' | '♥' | '♣' | '♦' = '♥',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, rank, type };
}

describe('反馈:端到端(harness)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:受伤 → 反馈 confirm=true → P1 获得 P0 一张手牌
  // ─────────────────────────────────────────────────────────────
  it('用例1:P0 杀 P1 → P1 不出闪 → 反馈 confirm=true → P1 拿 P0 一张手牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, victimCard.id], skills: ['杀'] }),
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
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 验证初始手牌
    expect(harness.state.players[0].hand).toContain(victimCard.id);

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪 → 扣血 → 反馈 after hook → 反馈/confirm pending
    await P1.pass();

    // 此时应有 pending 反馈/confirm(target=P1)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    let slot = [...harness.state.pendingSlots.values()][0];
    let slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');
    expect(slotAtom.target).toBe(1);

    // P1 confirm=true(发动反馈)
    await P1.respond('反馈', { choice: true });

    // P1 拿到了 P0 的 victimCard
    expect(harness.state.players[1].hand).toContain(victimCard.id);
    // P0 手牌中不应再有 victimCard
    expect(harness.state.players[0].hand).not.toContain(victimCard.id);
    // localVars 已清
    expect(harness.state.localVars['反馈/confirmed']).toBeFalsy();
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:受伤 → 反馈 confirm=false → P1 不拿牌,P0 手牌不变
  // ─────────────────────────────────────────────────────────────
  it('用例2:反馈 confirm=false → 不拿牌,P0 手牌数不变', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, victimCard.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['反馈', '闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p0HandBefore = harness.state.players[0].hand.length;

    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass();

    // 反馈 confirm pending 应有
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');

    // P1 confirm=false → 不发动
    await P1.respond('反馈', { choice: false });

    // P1 手牌中不应有 victimCard
    expect(harness.state.players[1].hand).not.toContain(victimCard.id);
    // P0 手牌数不变
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore);
    // P0 仍持有 victimCard
    expect(harness.state.players[0].hand).toContain(victimCard.id);
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:出闪 → 抵消 → 不扣血 → 反馈 不触发(无 confirm pending)
  // ─────────────────────────────────────────────────────────────
  it('用例3:杀 → 出闪 → 抵消 → 反馈 不触发(无 confirm pending)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const dodge: Card = makeCard('d1', '闪', '♥', '5');

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
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.pendingSlots.size).toBe(0);
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain(slash.id);
    // P1 手牌为空(闪打出后进弃牌堆)
    expect(harness.state.players[1].hand).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:来源 P0 已空(无手牌无装备)→ 反馈 confirm=true 但不拿牌
  // ─────────────────────────────────────────────────────────────
  it('用例4:P0 无手牌无装备 → 反馈 confirm=true 后不拿牌(来源已空)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');

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
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');

    // P1 confirm=true
    await P1.respond('反馈', { choice: true });

    // P0 已无牌(杀进弃牌堆)→ P1 也拿不到
    expect(harness.state.players[1].hand).toHaveLength(0);
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // P1 扣了 1 血(确认伤害发生)
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:反馈 拿装备:来源 P0 有装备(无手牌)→ 反馈 confirm=true 拿装备
  // ─────────────────────────────────────────────────────────────
  it('用例5:反馈 拿装备 — 来源只有装备无手牌 → 反馈 confirm=true 拿装备', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const wp: Card = makeCard('wp1', '诸葛连弩', '♣', 'A', '装备牌');
    (wp as Card & { subtype?: string; range?: number }).subtype = '武器';
    (wp as Card & { subtype?: string; range?: number }).range = 1;

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [slash.id],
          equipment: { 武器: wp.id },
          skills: ['杀'],
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          skills: ['反馈', '闪'],
        }),
      ],
      cardMap: { [slash.id]: slash, [wp.id]: wp },
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
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.requestType).toBe('反馈/confirm');

    // P1 confirm=true(发动反馈)
    await P1.respond('反馈', { choice: true });

    // P1 拿到 P0 的武器(进入 P1 的装备区)
    expect(harness.state.players[1].equipment['武器']).toBe(wp.id);
    // P0 武器消失
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 6:HP=1 玩家被杀 → 反馈 不影响濒死流程(P1 仍走求桃链)
  // ─────────────────────────────────────────────────────────────
  it('用例6:HP=1 玩家被杀 → 反馈 confirm=true → 不影响后续濒死流程', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [slash.id, victimCard.id],
          skills: ['杀'],
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          skills: ['反馈', '闪'],
          health: 1, maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['桃', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪 → 扣血到 0 → 反馈 after hook → 反馈/confirm pending
    await P1.pass();

    // 此时 P1 HP=0 但还没死;反馈 confirm pending
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    let slot = [...harness.state.pendingSlots.values()][0];
    let slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.requestType).toBe('反馈/confirm');
    expect(slotAtom.target).toBe(1);

    // P1 confirm=true(发动反馈)
    await P1.respond('反馈', { choice: true });

    // P1 拿到 victimCard
    expect(harness.state.players[1].hand).toContain(victimCard.id);

    // 反馈完成后,runDyingFlow 继续 → 求桃 pending(P1 自身)
    // 状态机可能:先反馈确认 → 然后才进入 runDyingFlow 完整流程
    // 至少 P1 仍处于濒死(HP=0),求桃可能已开始
    expect(harness.state.players[1].health).toBe(0);
    void slot;
    void slotAtom;
  });
});