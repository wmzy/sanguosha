// tests/integration/dying-peach.test.ts
// 集成测试:濒死求桃链(杀 → 濒死 → 求桃链)。
//
// 覆盖:
//   1. 杀 → 不救 → 死亡:P1 HP=1 被 P0 杀 → 没人救 → P1 死亡,手牌装备入弃牌堆
//   2. 杀 → 救 → 回 1 血:P1 HP=1 被 P0 杀 → P2 出桃 → P1 救回(HP=1)
//   3. 求桃顺序:target → +1 → +2(4 人局,只在 P2 处救回 → 链不继续到 P3)
//   4. 自救优先:濒死玩家自己有桃 → 第一问即救,不会问下家
//
// 关键机制(系统规则.ts runDyingFlow):
//   从 targetIdx 开始绕一圈,逐个 ask 每个 alive 玩家是否用桃
//   - 用 桃.respond action 出桃 → localVars['求桃/已救'] = true → 给 target +1 体力,跳出循环
//   - 全部 ask 完仍 HP<=0 → 击杀 target
//
// 模式:SkillTestHarness + useCardAndTarget + pass(响应闪) + respond(出桃)
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

describe('濒死求桃链:端到端(harness)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:杀 → 不救 → 死亡
  // ─────────────────────────────────────────────────────────────
  it('用例1:P1 HP=1 → P0 杀 → 链上无人救 → P1 死亡(手牌装备入弃牌堆)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const deadHand: Card = makeCard('d1', '杀', '♥', '9');
    const wp: Card = makeCard('wp1', '诸葛连弩', '♣', 'A', '装备牌');
    (wp as Card & { subtype?: string; range?: number }).subtype = '武器';
    (wp as Card & { subtype?: string; range?: number }).range = 1;

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [deadHand.id],
          equipment: { 武器: wp.id },
          skills: ['桃', '闪'],
          health: 1, maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['桃', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [deadHand.id]: deadHand, [wp.id]: wp },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪 → 扣血 → runDyingFlow
    await P1.pass();

    // 第一个 求桃 应该问 P1(target=1)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    let slot = [...harness.state.pendingSlots.values()][0];
    let slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('桃/求桃');
    expect(slotAtom.target).toBe(1);

    // P1 不救(无桃)
    await P1.pass();

    // 第二个 求桃 应该问 P2(target=2)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    slot = [...harness.state.pendingSlots.values()][0];
    slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('桃/求桃');
    expect(slotAtom.target).toBe(2);

    // P2 不救(也无桃)
    await P2.pass();

    // 求桃链绕一圈:链尾是 P0(targetIdx=1 → P1 → P2 → P0)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    slot = [...harness.state.pendingSlots.values()][0];
    slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('桃/求桃');
    expect(slotAtom.target).toBe(0);

    // P0 不救(也无桃)
    await P0.pass();

    // 全部超时 → P1 死亡
    expect(harness.state.players[1].alive).toBe(false);
    expect(harness.state.players[1].health).toBe(0);
    // P1 手牌入弃牌堆
    expect(harness.state.players[1].hand).toHaveLength(0);
    expect(harness.state.zones.discardPile).toContain(deadHand.id);
    // P1 装备入弃牌堆
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain(wp.id);
    // 求桃 已救 标志清掉
    expect(harness.state.localVars['求桃/已救']).toBeUndefined();
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:杀 → 求桃 → P2 出桃救回 → 回 1 血
  // ─────────────────────────────────────────────────────────────
  it('用例2:P1 HP=1 → P0 杀 → P1 不救 → P2 出桃 → P1 救回(HP=1)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const peach: Card = makeCard('p1', '桃', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          skills: ['桃', '闪'],
          health: 1, maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [peach.id], skills: ['桃', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [peach.id]: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪 → 扣血 → runDyingFlow
    await P1.pass();

    // 第一个 求桃 应该问 P1(target=1)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot1 = [...harness.state.pendingSlots.values()][0];
    const slotAtom1 = slot1.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom1.requestType).toBe('桃/求桃');
    expect(slotAtom1.target).toBe(1);
    // P1 不救
    await P1.pass();

    // 第二个 求桃 应该问 P2(target=2)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot2 = [...harness.state.pendingSlots.values()][0];
    const slotAtom2 = slot2.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom2.requestType).toBe('桃/求桃');
    expect(slotAtom2.target).toBe(2);

    // P2 出桃救回
    await P2.respond('桃', { cardId: peach.id });

    // P1 救回:HP=1,alive=true
    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
    // P2 的桃进弃牌堆
    expect(harness.state.zones.discardPile).toContain(peach.id);
    // P2 手牌为空
    expect(harness.state.players[2].hand).not.toContain(peach.id);
    // 求桃 已救 标志清掉
    expect(harness.state.localVars['求桃/已救']).toBeUndefined();
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:求桃链顺序 = target → +1 → +2(4 人局)
  // ─────────────────────────────────────────────────────────────
  it('用例3:4 人局求桃顺序 = target → +1 → +2(P3 未被问到,因为 P2 救回)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const peach: Card = makeCard('p1', '桃', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['桃', '闪'], health: 1, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: [peach.id], skills: ['桃', '闪'] }),
        makePlayer({ index: 3, name: 'P3', hand: [], skills: ['桃', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [peach.id]: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪
    await P1.pass();

    // 第一问 P1(target=1)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot1 = [...harness.state.pendingSlots.values()][0];
    const slotAtom1 = slot1.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom1.target).toBe(1);
    await P1.pass();

    // 第二问 P2(target=2)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot2 = [...harness.state.pendingSlots.values()][0];
    const slotAtom2 = slot2.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom2.target).toBe(2);

    // P2 出桃
    await P2.respond('桃', { cardId: peach.id });

    // P1 救回(HP=1,alive=true)
    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
    // 桃进弃牌堆
    expect(harness.state.zones.discardPile).toContain(peach.id);
    // P3 未被问(链在 P2 处停下)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:濒死玩家自救(优先级最高)→ 不会问下家
  // ─────────────────────────────────────────────────────────────
  it('用例4:P1 自己有桃 → 濒死链第一问即救,不会问 P2', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const peach: Card = makeCard('p1', '桃', '♥', '5');
    const decoy: Card = makeCard('d1', '杀', '♣', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [peach.id],
          skills: ['桃', '闪'],
          health: 1, maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [decoy.id], skills: ['桃', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [peach.id]: peach, [decoy.id]: decoy },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪
    await P1.pass();

    // 第一问 P1(target=1)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('桃/求桃');
    expect(slotAtom.target).toBe(1);

    // P1 用桃救自己
    await P1.respond('桃', { cardId: peach.id });

    // P1 救回
    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
    // P1 的桃进弃牌堆
    expect(harness.state.zones.discardPile).toContain(peach.id);
    // P2 的牌没动
    expect(harness.state.players[2].hand).toContain(decoy.id);
    expect(harness.state.zones.discardPile).not.toContain(decoy.id);
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});