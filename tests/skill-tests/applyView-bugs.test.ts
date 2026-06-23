// tests/skill-tests/applyView-bugs.test.ts
// 验证 apply 与 applyView 的一致性：apply 修改 GameState，applyView 修改 GameView。
// 如果两者不一致，前端（走事件流 applyView）看到的与引擎 state（测试断言的）不同。
// 这些 bug 之前测不出来，因为绝大多数测试断言 harness.state（绝对真实）而非 processedView。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { getAtomDef } from '../../src/engine/atom';
import type { GameView } from '../../src/engine/types';

/** 构造一个最小化 mock GameView 用于直接调用 applyView */
function mockView(overrides: Partial<GameView> = {}): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      { index: 0, name: 'P1', character: '', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 0, marks: [] },
      { index: 1, name: 'P2', character: '', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 0, marks: [] },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    zones: { deckCount: 10, discardPileCount: 0, processing: [] },
    ...overrides,
  };
}

describe('applyView 一致性 bug', () => {
  describe('弃置 atom: equipment 未清除', () => {
    it('apply 清 equipment 但 applyView 不清 → 装备被弃后前端仍显示', () => {
      const def = getAtomDef('弃置');
      const view = mockView({
        players: [
          {
            index: 0, name: 'P1', character: '', health: 4, maxHealth: 4, alive: true,
            equipment: { 武器: 'w1' }, skills: [], handCount: 1,
            hand: [{ id: 'h1', name: '杀', suit: '♠', rank: '1', type: '基本牌' }], marks: [],
          },
          { index: 1, name: 'P2', character: '', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 0, marks: [] },
        ],
      });

      // 弃置 w1 (装备) 和 h1 (手牌)
      def.applyView!(view, { type: '弃置', player: 0, cardIds: ['w1', 'h1'] } as any);

      expect(view.players[0].handCount).toBe(0);       // ✅ 正确
      expect(view.players[0].hand).toEqual([]);         // ✅ 正确
      expect(view.players[0].equipment['武器']).toBeUndefined(); // ❌ BUG: 实际仍是 'w1'
    });
  });

  describe('获得 atom: from 玩家视图不同步', () => {
    it('apply 从 from 移除手牌/装备, applyView 不处理 from 的 handCount/equipment', () => {
      const def = getAtomDef('获得');
      const view = mockView({
        players: [
          { index: 0, name: 'P1', character: '', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 0, marks: [] },
          {
            index: 1, name: 'P2', character: '', health: 4, maxHealth: 4, alive: true,
            equipment: {}, skills: [], handCount: 1,
            hand: [{ id: 'c2', name: '杀', suit: '♥', rank: '3', type: '基本牌' }], marks: [],
          },
        ],
        cardMap: { c2: { id: 'c2', name: '杀', suit: '♥', rank: '3', type: '基本牌' } },
      });

      // P0 从 P1 获得 c2
      def.applyView!(view, { type: '获得', player: 0, cardId: 'c2', from: 1 } as any);

      expect(view.players[0].handCount).toBe(1); // ✅ 获得者 +1
      expect(view.players[1].handCount).toBe(0); // ❌ BUG: from 玩家仍为 1,未 -1
    });
  });

  describe('判定 atom: deckCount 未递减', () => {
    it('apply 从 deck shift 到 processing, applyView 不减 deckCount', () => {
      const def = getAtomDef('判定');
      const view = mockView();

      const before = view.zones!.deckCount;
      def.applyView!(view, {} as any);

      // processing 被 pop（afterHook 模拟），但 deckCount 应该 -1（牌从牌堆翻出）
      expect(view.zones!.deckCount).toBe(before - 1); // ❌ BUG: 实际仍为 10
    });
  });

  describe('加标记 atom: 缺少 applyView', () => {
    it('apply 加 mark, 但 applyView 不存在 → 前端 marks 永不更新', () => {
      const def = getAtomDef('加标记');
      expect(def.applyView).toBeDefined(); // ❌ BUG: 实际为 undefined
    });
  });

  describe('去标记 atom: 缺少 applyView', () => {
    it('apply 移除 mark, 但 applyView 不存在', () => {
      const def = getAtomDef('去标记');
      expect(def.applyView).toBeDefined(); // ❌ BUG
    });
  });

  describe('清过期标记 atom: 缺少 applyView', () => {
    it('apply 清 duration===turn marks, 但 applyView 不存在', () => {
      const def = getAtomDef('清过期标记');
      expect(def.applyView).toBeDefined(); // ❌ BUG
    });
  });

  describe('击杀 atom: discardPileCount 未增加', () => {
    it('apply 把手牌+装备进弃牌堆, applyView 不增加 discardPileCount', () => {
      const def = getAtomDef('击杀');
      const view = mockView({
        players: [
          {
            index: 0, name: 'P1', character: '', health: 0, maxHealth: 4, alive: true,
            equipment: { 武器: 'e1' }, skills: [], handCount: 2,
            hand: [
              { id: 'h1', name: '杀', suit: '♠', rank: '1', type: '基本牌' },
              { id: 'h2', name: '闪', suit: '♥', rank: '2', type: '基本牌' },
            ],
            marks: [],
          },
          { index: 1, name: 'P2', character: '', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 0, marks: [] },
        ],
      });

      const before = view.zones!.discardPileCount;
      def.applyView!(view, { type: '击杀', player: 0 } as any);

      // apply: 2 手牌 + 1 装备 = 3 张进弃牌堆
      expect(view.zones!.discardPileCount).toBe(before + 3); // ❌ BUG: 实际仍为 0
    });
  });

  describe('获得/给予 atom: 信息分级泄露', () => {
    it('获得 toViewEvents 用 othersView 公开 cardId → 第三方知道顺手牵羊拿了什么牌', () => {
      const def = getAtomDef('获得');
      const split = def.toViewEvents!(
        { players: [], cardMap: { c2: { id: 'c2', name: '杀', suit: '♥', rank: '3', type: '基本牌' } }, zones: { deck: [], discardPile: [], processing: [] } } as any,
        { type: '获得', player: 0, cardId: 'c2', from: 1 } as any,
      );
      // othersView 不应携带 cardId（第三方不应知道获得了什么牌）
      expect((split?.othersView as any)?.cardId).toBeUndefined();
    });
  });
});
