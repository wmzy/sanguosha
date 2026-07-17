// 奋激(界周泰·吴·触发技)测试(OL hero/210 官方逐字):
//   "当一名角色的手牌被弃置或获得后,你可以失去1点体力令其摸两张牌。"
//
// 测试场景:
//   1. 弃置触发:P2 被弃置一张手牌 → 周泰触发奋激 → 失1体力 → P2 摸2张
//   2. 获得(顺手牵羊)触发:P2 顺手牵羊拿周泰一张牌 → 周泰触发奋激 → 失1体力 → P2 摸2张
//   3. 不发动:周泰 confirm false → 无效果
//   4. 周泰体力=1时发动奋失去体力 → 进入濒死(无桃)→ 死亡 → 目标不摸牌
//
// 触发方式:用 弃置 atom 直接驱动(after-hook 挂在 弃置/获得)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  vars?: Record<string, unknown>;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as GameState['players'][number]['vars'],
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('奋激', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 弃置触发:周泰发动奋激 → P2 摸2张 ──────────────────────
  it('P2 手牌被弃置 → 周泰发动奋激 → 失1体力 → P2 摸2张', async () => {
    const p2c1 = mkCard('p2c1', '杀');
    const p2c2 = mkCard('p2c2', '闪');
    const d1 = mkCard('d1', '桃', '♥');
    const d2 = mkCard('d2', '酒', '♣');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['奋激'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            hand: [p2c1.id, p2c2.id],
            skills: [],
          }),
        ],
        cardMap: { p2c1, p2c2, d1, d2 },
        zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 直接 applyAtom(弃置) 触发奋激 after-hook(P2 被弃一张)
    void applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['p2c1'] });
    await harness.waitForStable();

    // 周泰被询问是否发动奋激
    const ZT = harness.player('界周泰');
    ZT.expectPending('请求回应');
    await ZT.respond('奋激', { choice: true }); // 发动
    await harness.waitForStable();

    // 周泰失1体力(4→3);P2 原1张(剩 p2c2)+ 摸2 = 3 张
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[1].hand).toContain('p2c2');
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.players[1].hand).toContain('d2');
    // p2c1 已被弃
    expect(harness.state.zones.discardPile).toContain('p2c1');
  });

  // ─── 弃置触发但周泰不发动 ──────────────────────────────────
  it('P2 手牌被弃置 → 周泰选择不发动 → 无效果', async () => {
    const p2c1 = mkCard('p2c1', '杀');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['奋激'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            hand: [p2c1.id],
            skills: [],
          }),
        ],
        cardMap: { p2c1 },
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['p2c1'] });
    await harness.waitForStable();

    const ZT = harness.player('界周泰');
    ZT.expectPending('请求回应');
    await ZT.respond('奋激', { choice: false }); // 不发动
    await harness.waitForStable();

    // 周泰体力不变;P2 手牌为空(被弃后没补)
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].hand.length).toBe(0);
  });

  // ─── 获得(顺手牵羊)触发 ────────────────────────────────────
  it('P2 获得(顺手牵羊)周泰一张牌 → 周泰发动奋激 → P2 摸2张', async () => {
    const ztCard = mkCard('zc1', '杀', '♠');
    const d1 = mkCard('d1', '桃', '♥');
    const d2 = mkCard('d2', '酒', '♣');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['奋激'],
            health: 4,
            maxHealth: 4,
            hand: [ztCard.id],
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            skills: [],
          }),
        ],
        cardMap: { zc1: ztCard, d1, d2 },
        zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // P2 获得周泰的 zc1(顺手牵羊结算的内部就是 获得 atom)
    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'zc1', from: 0 });
    await harness.waitForStable();

    const ZT = harness.player('界周泰');
    ZT.expectPending('请求回应');
    await ZT.respond('奋激', { choice: true });
    await harness.waitForStable();

    // 周泰失1体力(4→3);P2 获得了 zc1 + 摸2 = 3 张
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[1].hand).toContain('zc1');
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.players[1].hand).toContain('d2');
  });

  // ─── 周泰体力=1时发动奋激 → 失血致死 → 目标不摸牌 ──────────
  it('周泰体力1发动奋激 → 失血进入濒死(无桃)→ 死亡 → 目标不摸牌', async () => {
    const p2c1 = mkCard('p2c1', '杀');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['奋激'], // 无不屈,体力1即濒死
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            hand: [p2c1.id],
            skills: [],
          }),
        ],
        cardMap: { p2c1 },
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['p2c1'] });
    await harness.waitForStable();

    const ZT = harness.player('界周泰');
    ZT.expectPending('请求回应');
    await ZT.respond('奋激', { choice: true }); // 发动
    await harness.waitForStable();

    // 周泰失1体力 → 体力0 → 进入濒死 → 求桃;两人都无桃 → pass 掉所有求桃
    while (harness.state.pendingSlots.size > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const target = (slot.atom as { target?: number }).target ?? 0;
      await harness.player(target).pass();
      await harness.waitForStable();
    }

    // 周泰死亡;P2 手牌空(目标未摸牌)
    expect(harness.state.players[0].alive).toBe(false);
    expect(harness.state.players[1].hand.length).toBe(0);
  });
});
