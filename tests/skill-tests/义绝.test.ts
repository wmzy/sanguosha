// tests/skill-tests/义绝.test.ts
// 义绝(界关羽·蜀·主动技,OL 界限突破官方)测试:
//   出牌阶段限一次,你可以弃置一张牌,然后令一名其他角色展示一张手牌。若此牌为:
//     黑色,其本回合非锁定技失效且不能使用或打出手牌,你本回合对其使用的红桃【杀】伤害+1;
//     红色,你获得之,然后你可以令其回复1点体力。
//
// 验证:
//   1. 黑色分支:弃牌 + 目标展示黑牌 → 加三标签(封非锁定技/禁出牌/红桃杀加伤)
//   2. 红色分支:弃牌 + 目标展示红牌 → owner 获得此牌
//   3. 红色分支-回血:owner 选择回血 → target +1 体力
//   4. 红色分支-不回血:owner 选择不回血 → target 体力不变
//   5. 红桃杀加伤:黑色分支后 owner 红桃杀 → target -2 体力
//   6. 禁出牌:黑色分支后 target 询问闪被跳过(强制命中)
//   7. 封非锁定技:黑色分支后 target 的反馈不触发
//   8. 限一次:本回合已用 → 再次使用被拒
//   9. 负面:目标无手牌 / 对自己 / 非自己回合 / 无代价牌 → 拒绝
//   10. 超时兜底:目标不选 → 自动展示第一张
//   11. 回合结束清标签
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, EquipSlot, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  equipment?: Partial<Record<EquipSlot, string>>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界关羽',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['义绝'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('义绝', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 黑色分支:加三标签 ─────────────────────────────

  it('黑色:弃代价 + 目标展示♠ → 加封非锁定技/禁出牌/红桃杀加伤标签', async () => {
    const cost = makeCard('c1', '杀', '♠', '7'); // 代价牌
    const targetCard = makeCard('t1', '杀', '♠', 'A'); // 目标手牌(黑色)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝', '杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: { c1: cost, t1: targetCard },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 发动义绝:弃 c1, 目标 P2
    await P1.useCardAndTarget('义绝', 'c1', [1]);

    // 应有义绝展示 pending(P2 选一张展示)
    P2.expectPending('请求回应');

    // P2 选 t1(黑色)
    await P2.respond('义绝', { cardId: 't1' });

    // 代价牌 c1 已弃
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c1');
    // 目标 t1 仍在 P2 手牌(黑色分支不获得此牌)
    expect(harness.state.players[1].hand).toContain('t1');
    // P2 加三标签
    expect(harness.state.players[1].tags).toContain('义绝/非锁定技失效');
    expect(harness.state.players[1].tags).toContain('义绝/禁出牌');
    expect(harness.state.players[1].tags).toContain('义绝/红桃杀加伤');
  });

  // ─── 红色分支:owner 获得此牌 + 回血 ─────────────────────────────

  it('红色+回血:目标展示♥ → owner 获得此牌 + 选择回血 → target +1 体力', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard = makeCard('t1', '桃', '♥', '5'); // 红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
          health: 3, // 未满血,可回血
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: cost, t1: targetCard },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('义绝', 'c1', [1]);
    P2.expectPending('请求回应');
    await P2.respond('义绝', { cardId: 't1' });

    // 红色分支:owner 被询问是否回血
    P1.expectPending('请求回应');
    await P1.respond('义绝', { choice: true });

    // owner 获得 t1
    expect(harness.state.players[0].hand).toContain('t1');
    expect(harness.state.players[1].hand).not.toContain('t1');
    // P2 回 1 体力(3→4)
    expect(harness.state.players[1].health).toBe(4);
    // P2 无任何义绝标签
    expect(harness.state.players[1].tags).toEqual([]);
  });

  // ─── 红色分支:owner 获得此牌 + 不回血 ─────────────────────────────

  it('红色+不回血:目标展示♦ → owner 获得此牌 + 选择不回血 → target 体力不变', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard = makeCard('t1', '闪', '♦', '5'); // 红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
          health: 3,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: cost, t1: targetCard },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('义绝', 'c1', [1]);
    await P2.respond('义绝', { cardId: 't1' });

    // owner 选择不回血
    P1.expectPending('请求回应');
    await P1.respond('义绝', { choice: false });

    // owner 获得 t1
    expect(harness.state.players[0].hand).toContain('t1');
    // P2 体力不变
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 红桃杀加伤:黑色分支后 owner 红桃杀 → -2 ─────────────────────────────

  it('黑色分支后 owner 红桃杀 → target 受 2 点伤害', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard = makeCard('t1', '桃', '♣', '5'); // 黑色(目标展示)
    const heartKill = makeCard('k1', '杀', '♥', '3'); // owner 红桃杀
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'k1'],
          skills: ['义绝', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: { c1: cost, t1: targetCard, k1: heartKill },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 先用义绝(黑色分支)
    await P1.useCardAndTarget('义绝', 'c1', [1]);
    await P2.respond('义绝', { cardId: 't1' });

    // P2 已加红桃杀加伤标签
    expect(harness.state.players[1].tags).toContain('义绝/红桃杀加伤');

    // owner 对 P2 使用红桃杀
    await P1.useCardAndTarget('杀', 'k1', [1]);

    // P2 被禁出牌 → 询问闪被 cancel,强制命中
    // 红桃杀 + 义绝加伤 → 2 点伤害
    expect(harness.state.players[1].health).toBe(2);
    // 加伤标签单次消费
    expect(harness.state.players[1].tags).not.toContain('义绝/红桃杀加伤');
  });

  // ─── 禁出牌:target 询问闪被跳过 ─────────────────────────────

  it('黑色分支后 target 被禁出牌 → 杀的询问闪被跳过,强制命中', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard = makeCard('t1', '杀', '♣', '5'); // 黑色(目标展示)
    const kill = makeCard('k1', '杀', '♠', '3'); // 普通黑桃杀
    const dodge = makeCard('d1', '闪', '♥', '2'); // P2 有闪但不能用
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'k1'],
          skills: ['义绝', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 'd1'],
          skills: ['闪'],
        }),
      ],
      cardMap: { c1: cost, t1: targetCard, k1: kill, d1: dodge },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 先用义绝(黑色分支)
    await P1.useCardAndTarget('义绝', 'c1', [1]);
    await P2.respond('义绝', { cardId: 't1' });

    // P2 已被禁出牌
    expect(harness.state.players[1].tags).toContain('义绝/禁出牌');

    // owner 用普通杀
    await P1.useCardAndTarget('杀', 'k1', [1]);

    // 禁出牌 → 询问闪被 cancel,无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // P2 受 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
    // P2 的闪仍在手里(没能用出)
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 封非锁定技:target 反馈不触发 ─────────────────────────────

  it('黑色分支后 target 非锁定技(反馈)失效,受伤后不触发', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard = makeCard('t1', '杀', '♣', '5'); // 黑色
    const kill = makeCard('k1', '杀', '♠', '3'); // 普通黑桃杀
    // P1 多一张装备可被反馈的牌
    const equip = makeCard('p1', '桃', '♦', '3', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'k1'],
          equipment: { 武器: 'p1' },
          skills: ['义绝', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '司马懿',
          hand: ['t1'],
          skills: ['反馈'],
        }),
      ],
      cardMap: { c1: cost, t1: targetCard, k1: kill, p1: equip },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('义绝', 'c1', [1]);
    await P2.respond('义绝', { cardId: 't1' });

    // P2 反馈(非锁定技)被压制
    expect(harness.state.players[1].tags).toContain('义绝/非锁定技失效');

    // owner 用普通杀
    await P1.useCardAndTarget('杀', 'k1', [1]);

    // 受 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
    // 反馈未触发(无 pending)
    expect(harness.state.pendingSlots.size).toBe(0);
    // P1 的装备未被反馈拿走
    expect(harness.state.players[0].equipment['武器']).toBe('p1');
  });

  // ─── 限一次 ─────────────────────────────

  it('限一次:本回合已用 → 再次使用被拒', async () => {
    const cost1 = makeCard('c1', '杀', '♠', '7');
    const cost2 = makeCard('c2', '杀', '♠', '8');
    const targetCard = makeCard('t1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2'],
          skills: ['义绝', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: { c1: cost1, c2: cost2, t1: targetCard },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一次使用:成功
    await P1.useCardAndTarget('义绝', 'c1', [1]);
    await P2.respond('义绝', { cardId: 't1' });

    // 第二次使用:被拒(限一次)
    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'c2', targets: [1] },
    });
  });

  // ─── 负面:各种拒绝条件 ─────────────────────────────

  it('use:目标无手牌 → 拒绝', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: [], skills: [] }),
      ],
      cardMap: { c1: cost },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'c1', targets: [1] },
    });
  });

  it('use:对自己使用 → 拒绝', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: { c1: cost, t1: makeCard('t1', '杀', '♠', 'A') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'c1', targets: [0] },
    });
  });

  it('use:非自己回合 → 拒绝', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: { c1: cost, t1: makeCard('t1', '杀', '♠', 'A') },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'c1', targets: [1] },
    });
  });

  it('use:无代价牌 → 拒绝', async () => {
    const targetCard = makeCard('t1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['义绝'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: { t1: targetCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'nonexistent', targets: [1] },
    });
  });

  // ─── 超时兜底:目标不选 → 自动展示第一张 ─────────────

  it('超时:目标不选牌 → 自动展示手牌第一张', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard1 = makeCard('t1', '杀', '♠', 'A'); // 第一张(黑色)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: { c1: cost, t1: targetCard1 },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('义绝', 'c1', [1]);
    P2.expectPending('请求回应');

    // 超时:目标不选 → 自动展示第一张(t1 黑色)
    await P2.pass();

    // 黑色分支 → P2 加禁出牌标签
    expect(harness.state.players[1].tags).toContain('义绝/禁出牌');
    expect(harness.state.players[1].tags).toContain('义绝/非锁定技失效');
    expect(harness.state.players[1].tags).toContain('义绝/红桃杀加伤');
  });

  // ─── 回合结束清标签 ─────────────────────────────

  it('回合结束后义绝标签被清除', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard = makeCard('t1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1'],
          skills: ['义绝', '杀', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: { c1: cost, t1: targetCard },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('义绝', 'c1', [1]);
    await P2.respond('义绝', { cardId: 't1' });

    // 标签已加
    expect(harness.state.players[1].tags).toContain('义绝/禁出牌');

    // 推进到回合结束
    const { applyAtom } = await import('../../src/engine/create-engine');
    await applyAtom(harness.state, { type: '回合结束', player: 0 });
    harness.processAllEvents();

    // 所有义绝标签被清除
    expect(harness.state.players[1].tags).not.toContain('义绝/禁出牌');
    expect(harness.state.players[1].tags).not.toContain('义绝/非锁定技失效');
    expect(harness.state.players[1].tags).not.toContain('义绝/红桃杀加伤');
  });
});
