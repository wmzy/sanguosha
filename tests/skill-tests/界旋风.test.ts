// 界旋风(界凌统·被动技)测试:
//   当你失去装备区里的牌后,或一次性失去至少两张牌后,
//   你可以依次弃置至多两名其他角色共计至多两张牌。
//
// 覆盖:
//   1. 卸下(替换装备)→ 失装备 → 触发 → 选目标 → 弃 1 张
//   2. 弃置(过河拆桥拆装备)→ 失装备 → 触发 → 弃 1 张
//   3. 获得(顺手牵羊顺装备)→ 失装备 → 触发 → 弃 1 张
//   4. 一次性失去≥2 张(被弃置 2 张手牌)→ 触发(条件 B)
//   5. 单次失去 1 张手牌(非装备)→ 不触发
//   6. 触发后弃 2 张(依次选 2 名不同角色)
//   7. 触发后选择不发动 → 不弃牌
//   8. 触发后弃 1 张,第二张选择结束 → 只弃 1 张
//   9. 同时失装备+丢2张(同一弃置 atom 弃 2 张装备)→ 仅触发 1 次
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeEquip(
  id: string,
  name: string,
  subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物',
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  range?: number,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype, range };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  vars?: Record<string, Json>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界凌统',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界旋风', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 替换装备(卸下)→ 触发 → 选目标 → 弃 1 张 ────────────
  it('替换装备(卸下)→ 触发 → 选目标 → 弃 1 张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: ['w2'],
          equipment: { 武器: 'w1' },
          skills: ['界旋风', '装备通用'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1', 'p2'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        w2: makeEquip('w2', '测试剑乙', '武器', '♥', 'A', 3),
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界凌统');
    const P1 = harness.player('P1');

    // 替换武器
    await P0.useCard('装备通用', 'w2');
    // 旋风 confirm 窗口
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });

    // 选目标窗口(choosePlayer):选 P1
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [1] });

    // 选牌窗口(pickTargetCard):选 P1 手牌盲选第 0 张
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });

    // 第二次 confirm:是否继续?选结束
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: false });

    // 验证:P1 被弃 1 张手牌
    expect(harness.state.players[1].hand.length).toBe(1);
    // 旧武器进弃牌堆,新武器占位
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].equipment['武器']).toBe('w2');
  });

  // ─── 2. 过河拆桥拆装备(弃置)→ 触发 → 弃 1 张 ──────────────
  it('过河拆桥拆我装备 → 触发 → 弃 1 张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: [],
          equipment: { 武器: 'w1' },
          skills: ['界旋风'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['gq1', 'p1', 'p2'],
          skills: ['过河拆桥'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        gq1: makeCard('gq1', '过河拆桥', '♠', 'A', '锦囊牌'),
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界凌统');

    // P1 出过河拆桥拆界凌统装备
    await P1.useCardAndTarget('过河拆桥', 'gq1', [0]);
    // 无懈窗口:无人打无懈
    await P1.pass();
    // 选牌面板:P1 选装备 zone=equipment
    await P1.respond('过河拆桥', { zone: 'equipment', cardId: 'w1' });

    // 旋风 confirm:界凌统发动
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });

    // 选目标:界凌统选 P1
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [1] });

    // 选牌:从 P1 手牌盲选第 0 张
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });

    // 第二次 confirm:不继续
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: false });

    // 验证:w1 进弃牌堆,P1 被弃 1 张手牌
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].hand.length).toBe(1);
  });

  // ─── 3. 顺手牵羊顺装备(获得)→ 触发 → 弃 1 张 ──────────────
  it('顺手牵羊顺我装备 → 触发 → 弃 1 张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: [],
          equipment: { 武器: 'w1' },
          skills: ['界旋风'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['sq1', 'p1', 'p2'],
          skills: ['顺手牵羊'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        sq1: makeCard('sq1', '顺手牵羊', '♠', 'A', '锦囊牌'),
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界凌统');

    // P1 出顺手牵羊顺界凌统装备
    await P1.useCardAndTarget('顺手牵羊', 'sq1', [0]);
    await P1.pass();
    await P1.respond('顺手牵羊', { zone: 'equipment', cardId: 'w1' });

    // 旋风 confirm
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });

    // 选目标
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [1] });

    // 选牌
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });

    // 第二次 confirm:不继续
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: false });

    // 验证:w1 被 P1 获得,P1 弃 1 张手牌
    expect(harness.state.players[1].hand).toContain('w1');
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    // P1 原 3 张(sq1 已使用 -1)+1 张 w1 -1 张被弃 = 2 张
    expect(harness.state.players[1].hand.length).toBe(2);
  });

  // ─── 4. 一次性失去≥2 张(被 弃置 atom 弃 2 张手牌)→ 触发条件 B ──
  it('一次性被弃 2 张手牌 → 触发(条件 B)', async () => {
    // 直接构造 弃置 atom 触发(模拟技能/效果一次性弃我 2 张)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: ['p1', 'p2'],
          skills: ['界旋风'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['e1', 'e2'],
        }),
      ],
      cardMap: {
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
        e1: makeCard('e1', '闪', '♦', '4'),
        e2: makeCard('e2', '杀', '♠', '5'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界凌统');

    // 直接 applyAtom 弃置 2 张手牌(走 hook pipeline)
    const { applyAtom } = await import('../../src/engine/create-engine');
    void (async () => {
      await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['p1', 'p2'] });
    })();
    await harness.waitForStable();
    harness.processAllEvents();

    // 旋风 confirm 触发
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });

    // 选目标
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [1] });

    // 选牌
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });

    // 不继续
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: false });

    // 验证:P1 被弃 1 张
    expect(harness.state.players[1].hand.length).toBe(1);
  });

  // ─── 5. 单次失去 1 张手牌(非装备)→ 不触发 ────────────────
  it('单次失去 1 张手牌 → 不触发旋风', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: ['p1', 'p2'],
          skills: ['界旋风'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['gq1', 'e1'],
          skills: ['过河拆桥'],
        }),
      ],
      cardMap: {
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
        gq1: makeCard('gq1', '过河拆桥', '♠', 'A', '锦囊牌'),
        e1: makeCard('e1', '闪', '♦', '4'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 拆 1 张手牌
    await P1.useCardAndTarget('过河拆桥', 'gq1', [0]);
    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });

    // 不触发旋风:无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // 手牌从 2 → 1(被拆 1 张)
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 6. 触发后弃 2 张(选 2 名不同角色)────────────────────
  it('依次弃 2 名不同角色各 1 张牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: [],
          equipment: { 武器: 'w1' },
          skills: ['界旋风'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1', 'p2'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p3', 'p4'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
        p3: makeCard('p3', '闪', '♦', '4'),
        p4: makeCard('p4', '杀', '♠', '5'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界凌统');

    // 直接弃置装备触发(用 applyAtom)
    const { applyAtom } = await import('../../src/engine/create-engine');
    void (async () => {
      await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['w1'] });
    })();
    await harness.waitForStable();
    harness.processAllEvents();

    // 旋风 confirm
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });

    // 第 1 次选目标:P1
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [1] });
    // 第 1 次选牌
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });

    // 第 2 次 confirm:继续
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });

    // 第 2 次选目标:P2
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [2] });
    // 第 2 次选牌
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });

    // 验证:P1 和 P2 各被弃 1 张
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
    expect(harness.state.zones.discardPile).toContain('w1');
  });

  // ─── 7. 触发后选择不发动 → 不弃牌 ────────────────────────
  it('替换装备 → 不发动旋风 → 不弃他人牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: ['w2'],
          equipment: { 武器: 'w1' },
          skills: ['界旋风', '装备通用'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1', 'p2'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        w2: makeEquip('w2', '测试剑乙', '武器', '♥', 'A', 3),
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界凌统');

    await P0.useCard('装备通用', 'w2');
    // confirm:不发动
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: false });

    // 不弃他人牌
    expect(harness.state.players[1].hand.length).toBe(2);
    // 旧武器进弃牌堆
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].equipment['武器']).toBe('w2');
  });

  // ─── 8. 触发后弃 1 张,第二张选择结束 ─────────────────────
  it('替换装备 → 弃 1 张后选结束 → 仅弃 1 张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: ['w2'],
          equipment: { 武器: 'w1' },
          skills: ['界旋风', '装备通用'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1', 'p2', 'p3'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        w2: makeEquip('w2', '测试剑乙', '武器', '♥', 'A', 3),
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
        p3: makeCard('p3', '桃', '♥', '4'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界凌统');

    await P0.useCard('装备通用', 'w2');
    // confirm:发动
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });
    // 选目标:P1
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [1] });
    // 选牌
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });
    // 第二次 confirm:不继续
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: false });

    // 仅弃 1 张
    expect(harness.state.players[1].hand.length).toBe(2);
  });

  // ─── 9. 同一弃置 atom 弃 2 件装备(失装备+丢2张)→ 仅触发 1 次 ─
  it('同一弃置 atom 弃 2 件装备 → 仅触发 1 次', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界凌统',
          hand: [],
          equipment: { 武器: 'w1', 防具: 'a1' },
          skills: ['界旋风'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1', 'p2'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        a1: makeEquip('a1', '测试甲', '防具', '♥', 'A'),
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界凌统');

    // 一次性弃置 2 件装备(同时满足失装备+丢2张两条件)
    const { applyAtom } = await import('../../src/engine/create-engine');
    void (async () => {
      await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['w1', 'a1'] });
    })();
    await harness.waitForStable();
    harness.processAllEvents();

    // 仅触发 1 次 confirm(若触发 2 次,pending 会被消费完)
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [1] });
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { targets: [1] });
    P0.expectPending('请求回应');
    await P0.respond('界旋风', { zone: 'hand', handIndex: 0 });

    // 完成后无 pending(若触发 2 次会有额外 pending 残留)
    expect(harness.state.pendingSlots.size).toBe(0);
    // 两件装备均进弃牌堆
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.zones.discardPile).toContain('a1');
    // P1 被弃 2 张(两轮各 1 张)
    expect(harness.state.players[1].hand.length).toBe(0);
  });
});
