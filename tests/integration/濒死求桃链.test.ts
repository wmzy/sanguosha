// tests/integration/濒死求桃链.test.ts
// 集成测试:濒死求桃链(多人依次问,直到有人救或无人救则死亡)
//
// 覆盖:
//   1. P0 杀 P1 → P1(HP=1)不出闪 → 濒死
//      求桃链路:P1 自身先被问 → P1 无桃(超时)→ P2 → P2 出桃救回 P1
//   2. 求桃链路多人超时 → 击杀 P1(alife=false,手牌装备进弃牌堆)
//   3. 多个濒死求桃:HP=1 的 P1 被杀,HP=1 的 P2 被杀 → 两次濒死链独立执行
//
// 关键机制(系统规则.ts runDyingFlow):
//   from targetIdx 开始绕一圈,逐个 ask 每个 alive 玩家 是否用桃
//   - 用 桃.respond action 出桃 → localVars['求桃/已救'] = true
//   - 然后 给 target +1 体力,跳出循环
//   - 全部 ask 完仍 HP<=0 → 击杀 target
//
// 模式:createGameState + registerSkillsFromState → dispatch 走真实 action 路径
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
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
  rank = '7',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, rank, type };
}

describe('濒死求桃链:多人依次问', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:P1 濒死 → 自身无桃 → P2 出桃救回
  // ─────────────────────────────────────────────────────────────
  it('用例1:P1(HP=1)被 P0 杀 → 自身无桃 → P2 出桃救回 P1(HP=2)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const peach: Card = makeCard('p1', '桃', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['桃', '闪'], health: 1, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: [peach.id], skills: ['桃', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [peach.id]: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const p1HealthBefore = state.players[1].health;
    expect(p1HealthBefore).toBe(1);

    // P0 对 P1 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    // 询问闪 pending(P1 须响应)
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    // P1 不出闪 → 扣血 → HP=0 → 触发 runDyingFlow
    // runDyingFlow 内部循环:
    //   1) P1(濒死)被问求桃 → confirm 窗口
    //   2) fireTimeout 后 P1 没救(无桃)
    //   3) P2 被问求桃
    // 我们的 fireTimeoutAndWait 只走一次;多轮需要手动 fireTimeout 多次
    // 第一次 fireTimeout:消耗 闪(无人出)→ 杀结算 → 造成伤害 → after hook 触发 runDyingFlow
    await fireTimeoutAndWait(state);
    // 此时:可能还在 runDyingFlow 内的 求桃 pending(系统规则已经创建了 请求回应 求桃)
    // 继续 fireTimeout 消耗求桃 — 第一次火 timeout(P1 不救)
    if (state.pendingSlots.size > 0) {
      const slot = [...state.pendingSlots.values()][0];
      const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
      // 求桃给 P1 时 target=1,给 P2 时 target=2
      if (slotAtom.type === '请求回应' && slotAtom.requestType === '桃/求桃' && slotAtom.target === 1) {
        await fireTimeoutAndWait(state);
      }
    }
    // 现在应该是 P2 的求桃 pending
    if (state.pendingSlots.size > 0) {
      const slot = [...state.pendingSlots.values()][0];
      const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
      expect(slotAtom.type).toBe('请求回应');
      expect(slotAtom.requestType).toBe('桃/求桃');
      expect(slotAtom.target).toBe(2);

      // P2 出桃救回
      await dispatchAndWait(state, {
        skillId: '桃',
        actionType: 'respond',
        ownerId: 2,
        params: { cardId: peach.id },
        baseSeq: state.seq,
      });
    }

    // P1 已被救回:HP>0,alive=true
    expect(state.players[1].health).toBeGreaterThan(0);
    expect(state.players[1].alive).toBe(true);
    // P1 初始 HP=1,扣 1 → HP=0(濒死) + 桃回复 1 → HP=1
    expect(state.players[1].health).toBe(1);
    // P2 的桃进弃牌堆
    expect(state.zones.discardPile).toContain(peach.id);
    // P2 手牌为空(桃被打出)
    expect(state.players[2].hand).not.toContain(peach.id);
    // 求桃已救 标志应被清掉
    expect(state.localVars['求桃/已救']).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:链上所有玩家超时 → P1 死亡(alive=false,手牌装备进弃牌堆)
  // ─────────────────────────────────────────────────────────────
  it('用例2:求桃链上所有人都超时 → P1 死亡,手牌和装备入弃牌堆', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    // 给 P1 一张废牌(应被打入弃牌堆)
    const deadHandCard: Card = makeCard('d1', '杀', '♥', '9');
    // 给 P1 一件装备
    const wp: Card = { id: 'wp1', name: '诸葛连弩', suit: '♣', rank: 'A', type: '装备牌', subtype: '武器', range: 1 };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [deadHandCard.id],
          equipment: { 武器: wp.id },
          skills: ['桃', '闪'],
          health: 1, maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['桃', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [deadHandCard.id]: deadHandCard, [wp.id]: wp },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // P0 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    // 反复 fireTimeout 消耗所有 pending:闪 → 伤害 → 濒死 → 求桃 × n → 击杀
    let loops = 0;
    while (state.pendingSlots.size > 0 && loops < 30) {
      await fireTimeoutAndWait(state);
      loops += 1;
    }
    expect(state.pendingSlots.size).toBe(0);

    // P1 已死
    expect(state.players[1].alive).toBe(false);
    expect(state.players[1].health).toBe(0);
    // P1 手牌入弃牌堆
    expect(state.players[1].hand).toHaveLength(0);
    expect(state.zones.discardPile).toContain(deadHandCard.id);
    // P1 装备入弃牌堆
    expect(state.players[1].equipment['武器']).toBeUndefined();
    expect(state.zones.discardPile).toContain(wp.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:濒死时濒死玩家可以自己用桃救自己(优先级最高)
  // ─────────────────────────────────────────────────────────────
  it('用例3:P1 自己有桃 → 濒死链第一问(P1 自己)即可救回,不会问 P2', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const peach: Card = makeCard('p1', '桃', '♥', '5');
    // P2 有一张无意义的牌(应该永远不被打出 — 验证求桃链在 P1 自救后停下)
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
        makePlayer({
          index: 2, name: 'P2',
          hand: [decoy.id],
          skills: ['桃', '闪'],
        }),
      ],
      cardMap: { [slash.id]: slash, [peach.id]: peach, [decoy.id]: decoy },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // P0 对 P1 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    // fireTimeout 消耗 闪 → 扣血 → runDyingFlow 第一个问 target=1(P1 自己)
    await fireTimeoutAndWait(state);

    // 现在应该有 求桃 pending target=1(P1)
    if (state.pendingSlots.size > 0) {
      const slot = [...state.pendingSlots.values()][0];
      const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
      expect(slotAtom.type).toBe('请求回应');
      expect(slotAtom.requestType).toBe('桃/求桃');
      expect(slotAtom.target).toBe(1);

      // P1 用桃救自己
      await dispatchAndWait(state, {
        skillId: '桃',
        actionType: 'respond',
        ownerId: 1,
        params: { cardId: peach.id },
        baseSeq: state.seq,
      });
    }

    // P1 已救回
    expect(state.players[1].alive).toBe(true);
    expect(state.players[1].health).toBe(1);
    // P1 的桃进弃牌堆
    expect(state.zones.discardPile).toContain(peach.id);
    // P2 的牌没动(求桃链在 P1 自救后结束,没问 P2)
    expect(state.players[2].hand).toContain(decoy.id);
    expect(state.zones.discardPile).not.toContain(decoy.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:濒死链路按座次绕一圈:targetIdx+1 → targetIdx+2 → ... → targetIdx
  // ─────────────────────────────────────────────────────────────
  it('用例4:4 人局,濒死链询问顺序 = target → +1 → +2 → +3', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    // P2 有桃(其他人都没有)
    const peach: Card = makeCard('p1', '桃', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        // P1 濒死(被 P0 杀)
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['桃', '闪'], health: 1, maxHealth: 4 }),
        // P2 有桃 — 第二个被问(targetIdx+1)
        makePlayer({ index: 2, name: 'P2', hand: [peach.id], skills: ['桃', '闪'] }),
        // P3 无桃 — 第三个被问(targetIdx+2)
        makePlayer({ index: 3, name: 'P3', hand: [], skills: ['桃', '闪'] }),
      ],
      cardMap: { [slash.id]: slash, [peach.id]: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // P0 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    // 第一次 fireTimeout:消耗 闪 → 扣血 → runDyingFlow 开始
    await fireTimeoutAndWait(state);
    // 此时第一个 求桃 target 应该是 P1(targetIdx+0 = 1)
    if (state.pendingSlots.size > 0) {
      const slot = [...state.pendingSlots.values()][0];
      const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
      expect(slotAtom.target).toBe(1);
      // P1 超时(无桃)
      await fireTimeoutAndWait(state);
    }
    // 第二个 target 应该是 P2(targetIdx+1 = 2)
    if (state.pendingSlots.size > 0) {
      const slot = [...state.pendingSlots.values()][0];
      const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
      expect(slotAtom.type).toBe('请求回应');
      expect(slotAtom.requestType).toBe('桃/求桃');
      expect(slotAtom.target).toBe(2);
      // P2 出桃
      await dispatchAndWait(state, {
        skillId: '桃',
        actionType: 'respond',
        ownerId: 2,
        params: { cardId: peach.id },
        baseSeq: state.seq,
      });
    }

    // P1 救回,P3 没被问(链在 P2 处停下)
    expect(state.players[1].alive).toBe(true);
    expect(state.players[1].health).toBe(1);
    expect(state.zones.discardPile).toContain(peach.id);
    // pending 已清
    expect(state.pendingSlots.size).toBe(0);
  });
});
