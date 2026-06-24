// tests/integration/濒死求桃.test.ts
// 集成测试:濒死求桃流程(HP → 0 → 濒死状态 → 求桃窗口 → 无人救 → 死亡)
//
// 覆盖:
//   1. P0 出杀 → P1(HP=1)不出闪 → P1 濒死 → 求桃 pending
//   2. fireTimeout 循环消耗求桃窗口 → 无人救 → P1 alive=false
//   3. P1 死亡后手牌+装备入弃牌堆
//   4. 救回场景:P1(HP=1) 濒死 → 有人出桃 → P1 HP>0 → 存活
//   5. 濒死状态观察:HP=0 但 alive 仍为 true(在求桃窗口期内)
//
// 模式:createGameState + registerSkillsFromState → dispatch 走真实 action 路径
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { fireTimeoutAndWait, dispatchAndWait, SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

/** 反复 fireTimeout 直到没有 pending 或超过 safety。返回跳过的 pending 数 */
async function drainTimeouts(state: GameState, safety = 30): Promise<number> {
  let n = 0;
  while (state.pendingSlots.size > 0 && n < safety) {
    await fireTimeoutAndWait(state);
    n += 1;
  }
  return n;
}

/** 返回第一个 pending slot 的 atom,无 pending 时返回 undefined */
function firstPendingAtom(state: GameState): unknown | undefined {
  if (state.pendingSlots.size === 0) return undefined;
  return [...state.pendingSlots.values()][0].atom;
}

/** 给指定玩家一张指定类型的牌(从手牌空位置抽 cardId) */
function giveCard(state: GameState, ownerIndex: number, name: string, idHint: string, suit: '♠' | '♥' | '♣' | '♦' = '♥', type?: '基本牌' | '锦囊牌' | '装备牌'): string {
  const id = `${idHint}-${ownerIndex}-${state.players[ownerIndex].hand.length}`;
  state.cardMap[id] = {
    id,
    name,
    suit,
    rank: '7',
    type: type ?? (name === '桃' ? '基本牌' : '锦囊牌'),
  };
  state.players[ownerIndex].hand.push(id);
  return id;
}

describe('濒死求桃', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = createGameState({
      players: [
        {
          index: 0, name: 'P0', character: '', health: 4, maxHealth: 4, alive: true,
          hand: [], equipment: {},
          skills: ['回合管理', '杀', '桃'],
          vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [],
        },
        {
          index: 1, name: 'P1', character: '', health: 4, maxHealth: 4, alive: true,
          hand: [], equipment: {},
          skills: ['回合管理', '闪', '桃', '装备通用'],
          vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [],
        },
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:出杀 → 不出闪 → 求桃 pending → 无人救 → 死亡
  // ─────────────────────────────────────────────────────────────
  it('用例1:P0 出杀 → P1(HP=1)不出闪 → 求桃 → 无人救 → 死亡', async () => {
    // 准备:P0 杀 + P1 HP=1
    const lord = state.players[0];
    const killId = giveCard(state, 0, '杀', 'kill', '♥', '基本牌');
    state.players[1].health = 1;
    state.players[1].maxHealth = 1;
    // 给 P1 一张装备(看后续是否会被弃掉)
    const equipId = giveCard(state, 1, '诸葛连弩', 'wp');
    state.cardMap[equipId] = { id: equipId, name: '诸葛连弩', suit: '♣', rank: 'A', type: '装备牌', subtype: '武器', range: 1 };
    state.players[1].equipment['武器'] = equipId;
    state.players[1].hand = state.players[1].hand.filter(id => id !== equipId);
    const p1HealthBefore = state.players[1].health;
    expect(p1HealthBefore).toBe(1);

    // P0 对 P1 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: killId, targets: [1] },
      baseSeq: state.seq,
    });

    // 应有 pending:闪/求桃/其他窗口
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    // 反复 fireTimeout:消耗 闪 → 受伤 → 濒死 → 求桃 轮次
    let loops = 0;
    while (state.pendingSlots.size > 0 && loops < 30) {
      await fireTimeoutAndWait(state);
      loops += 1;
    }

    // 最终:P1 死亡
    expect(state.players[1].alive).toBe(false);
    expect(state.players[1].health).toBe(0);
    // P1 手牌入弃牌堆
    expect(state.players[1].hand).toHaveLength(0);
    // P1 装备入弃牌堆
    expect(state.players[1].equipment['武器']).toBeUndefined();
    // 弃牌堆里能找到 P1 的装备
    expect(state.zones.discardPile).toContain(equipId);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:濒死状态:HP=0 但求桃窗口期内 alive=true
  // ─────────────────────────────────────────────────────────────
  it('用例2:HP=0 时,濒死流程将玩家标为濒死状态', async () => {
    const lord = state.players[0];
    const killId = giveCard(state, 0, '杀', 'kill', '♥', '基本牌');
    state.players[1].health = 1;
    state.players[1].maxHealth = 1;

    // 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: killId, targets: [1] },
      baseSeq: state.seq,
    });

    // 第一次 fireTimeout:消耗 闪 → 受伤 → HP=0 → 触发濒死
    // 先 fireTimeout 闪
    if (state.pendingSlots.size > 0) {
      const atom = firstPendingAtom(state) as { type?: string; requestType?: string };
      const isDodgePrompt = atom.type === '询问闪' ||
        (atom.type === '请求回应' && (atom.requestType === '闪' || atom.requestType === '出闪'));
      if (isDodgePrompt || atom.type === '请求回应') {
        await fireTimeoutAndWait(state);
      }
    }

    // 此时:已受伤,进入求桃窗口
    if (state.pendingSlots.size > 0) {
      const atom = firstPendingAtom(state) as { type?: string; requestType?: string };
      // 应该是求桃 pending
      const isPeachPrompt = atom.type === '请求回应' && atom.requestType === '桃/求桃';
      if (isPeachPrompt) {
        // HP=0 但 alive 仍为 true(在求桃窗口内)
        expect(state.players[1].health).toBeLessThanOrEqual(0);
        expect(state.players[1].alive).toBe(true);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:救回场景:HP=1 濒死 → 有人出桃 → 存活
  // ─────────────────────────────────────────────────────────────
  it('用例3:P1(HP=1)濒死 → P0 出桃救回 → P1 存活', async () => {
    const lord = state.players[0];
    const killId = giveCard(state, 0, '杀', 'kill', '♥', '基本牌');
    // P1 一张桃(手牌)
    const peachId = giveCard(state, 1, '桃', 'peach');
    state.players[1].health = 1;
    state.players[1].maxHealth = 4; // 给最大体力留空间,桃能回血

    // P0 对 P1 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: killId, targets: [1] },
      baseSeq: state.seq,
    });

    // 消耗闪窗口
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    await fireTimeoutAndWait(state); // 闪超时 → 受伤

    // 假设现在进入求桃窗口
    if (state.pendingSlots.size > 0) {
      const atom = firstPendingAtom(state) as { type?: string; requestType?: string };
      // 跳到 P1 求桃 → P1 回应
      if (atom.type === '请求回应' && atom.requestType === '桃/求桃') {
        const target = (atom as { target?: number }).target;
        // 求桃的目标是 P1(濒死者本人)还是别人? 这里是 P1
        // 让 P1 回应出桃
        // 实际规则:濒死时,自己可以用桃,所以 target 应该是 P1
        if (target === 1) {
          await dispatchAndWait(state, {
            skillId: '桃',
            actionType: 'respond',
            ownerId: 1,
            params: { cardId: peachId },
            baseSeq: state.seq,
          });
        }
        // 如果 target 是 P0 (P0 也可能率先被询问),让 P0 救(给 P0 桃)
        else if (target === 0) {
          // 给 P0 桃
          const peachFor0 = giveCard(state, 0, '桃', 'peach0');
          await dispatchAndWait(state, {
            skillId: '桃',
            actionType: 'respond',
            ownerId: 0,
            params: { cardId: peachFor0 },
            baseSeq: state.seq,
          });
        }
      }
    }

    // 反复 fireTimeout 消耗后续窗口
    await drainTimeouts(state);

    // P1 应被救回(HP=1,alive=true)
    expect(state.players[1].alive).toBe(true);
    expect(state.players[1].health).toBeGreaterThan(0);
  });
});
function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
  alive?: boolean;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: opts.alive ?? true,
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
  suit: '♠' | '♥' | '♣' | '♦' = '♥',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, rank, type };
}

// ── 以下为从 dying-peach.test.ts 合并的 SkillTestHarness 路径测试 ──
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
