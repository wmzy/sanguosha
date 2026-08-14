// 奋激(界周泰·吴·触发技)测试(OL hero/210 官方逐字):
//   "当一名角色的手牌被弃置或获得后,你可以失去1点体力令其摸两张牌。"
//
// 测试场景:
//   1. 被动弃置触发:P2 被弃置一张手牌 → 周泰触发奋激 → 失1体力 → P2 摸2张
//   2. 获得(顺手牵羊)触发:P2 拿周泰一张牌 → 周泰触发奋激 → 令失牌者(周泰)摸2张
//   3. 不发动:周泰 confirm false → 无效果
//   4. 周泰体力=1时发动奋失去体力 → 进入濒死(无桃)→ 死亡 → 目标不摸牌
//   5. 主动弃牌不触发:周泰自己弃2张(贯石斧代价,voluntary)→ 奋激不触发
//   6. 主动弃牌不触发:P2 主动弃牌(制衡代价,voluntary)→ 奋激不触发
//   7. 被动弃置触发(过河拆桥):周泰被拆牌弃置(非 voluntary)→ 奋激触发 → 周泰摸2张
//   8. 仅手牌触发:周泰装备区牌被弃置(非 voluntary)→ 奋激不触发(装备区弃置不触发)
//
// 触发方式:用 弃置/获得 atom 直接驱动(after-hook 挂在 弃置/获得)。
// voluntary 字段标记主动弃牌(技能代价),奋激 弃置 hook 据此跳过。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import { suitColor } from '../../src/engine/types';
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
  equipment?: Record<string, string>;
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
    equipment: opts.equipment ?? {},
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
  it('P2 获得(顺手牵羊)周泰一张牌 → 周泰发动奋激 → 令失牌者(周泰)摸2张', async () => {
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

    // P2 获得周泰的 zc1(顺手牵羊结算的内部就是 获得 atom;from=失牌者周泰)
    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'zc1', from: 0 });
    await harness.waitForStable();

    const ZT = harness.player('界周泰');
    ZT.expectPending('请求回应');
    await ZT.respond('奋激', { choice: true });
    await harness.waitForStable();

    // 周泰失1体力(4→3);官方规则令失牌者(atom.from=周泰)摸2张 → 周泰 hand=[d1,d2]
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[0].hand).toContain('d2');
    // P2 仅获得 zc1,不摸牌
    expect(harness.state.players[1].hand).toEqual(['zc1']);
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

  // ─── 主动弃牌(技能代价)不触发奋激 ──────────────────────────
  // 贯石斧:周泰自己主动弃2张作为代价(voluntary: true)→ 奋激不应触发
  it('贯石斧:周泰自己主动弃2张(voluntary)→ 奋激不触发', async () => {
    const zc1 = mkCard('zc1', '杀');
    const zc2 = mkCard('zc2', '闪');

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
            hand: [zc1.id, zc2.id],
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            skills: [],
          }),
        ],
        cardMap: { zc1, zc2 },
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 贯石斧代价弃2张——主动弃牌(voluntary: true)
    void applyAtom(harness.state, {
      type: '弃置',
      player: 0,
      cardIds: ['zc1', 'zc2'],
      voluntary: true,
    });
    await harness.waitForStable();

    // 奋激不触发:无询问,周泰体力不变
    harness.player('界周泰').expectNoPending();
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('zc1');
    expect(harness.state.zones.discardPile).toContain('zc2');
  });

  // ─── 主动弃牌(他人代价)不触发奋激 ──────────────────────────
  // 制衡:P2 主动弃自己的牌作为代价(voluntary: true)→ 周泰奋激不应触发
  it('制衡:P2 主动弃牌(voluntary)→ 周泰奋激不触发', async () => {
    const p2c1 = mkCard('p2c1', '杀');
    const p2c2 = mkCard('p2c2', '闪');

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
        cardMap: { p2c1, p2c2 },
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 制衡代价弃牌——P2 主动弃置(voluntary: true)
    void applyAtom(harness.state, {
      type: '弃置',
      player: 1,
      cardIds: ['p2c1'],
      voluntary: true,
    });
    await harness.waitForStable();

    // 奋激不触发:无询问,周泰体力不变
    harness.player('界周泰').expectNoPending();
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].hand).toEqual(['p2c2']);
  });

  // ─── 被动弃置(过河拆桥)正常触发奋激 ────────────────────────
  // 过河拆桥强制弃置周泰一张牌(非 voluntary)→ 奋激触发,令失牌者(周泰)摸2张
  it('过河拆桥:周泰被拆牌弃置(非 voluntary)→ 奋激触发 → 周泰摸2张', async () => {
    const zc1 = mkCard('zc1', '杀');
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
            hand: [zc1.id],
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            skills: [],
          }),
        ],
        cardMap: { zc1, d1, d2 },
        zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 过河拆桥强制弃置周泰的牌(非 voluntary,被动弃置)
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['zc1'] });
    await harness.waitForStable();

    const ZT = harness.player('界周泰');
    ZT.expectPending('请求回应');
    await ZT.respond('奋激', { choice: true });
    await harness.waitForStable();

    // 周泰失1体力(4→3);失牌者=周泰 → 摸2张(d1,d2)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[0].hand).toContain('d2');
    expect(harness.state.zones.discardPile).toContain('zc1');
  });

  // ─── 仅手牌触发:装备区弃置不触发奋激 ────────────────────────
  // 官方"当一名角色的【手牌】被弃置后"——装备区牌被弃置不触发。
  // 周泰装备区(武器槽)有一张牌,被弃置(非 voluntary)→ before-hook 快照手牌交集为空
  // → after-hook 不询问 → 无触发。验证「仅手牌」这一核心边界。
  it('周泰装备区牌被弃置(非 voluntary)→ 奋激不触发(仅手牌弃置触发)', async () => {
    const weapon = mkCard('zc1', '贯石斧', '♣', 'A', '装备牌');

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
            equipment: { weapon: weapon.id }, // 装备区,非手牌
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            skills: [],
          }),
        ],
        cardMap: { zc1: weapon },
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 强制弃置周泰装备区的牌(非 voluntary)
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['zc1'] });
    await harness.waitForStable();

    // 奋激不触发:无询问,周泰体力不变,装备已进弃牌堆
    harness.player('界周泰').expectNoPending();
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].equipment.武器).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('zc1');
  });
});
