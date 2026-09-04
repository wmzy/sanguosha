// tests/skill-tests/飞军.test.ts
// 飞军(王平·蜀·主动技)+ 兵略(锁定技)测试,风林火山 hero/401:
//   飞军:出牌阶段限一次,弃置一张牌,然后选择一项:
//     1.令一名手牌数大于你的角色交给你一张牌;
//     2.令一名装备区里牌数大于你的角色弃置一张装备区里的牌。
//   兵略:锁定技,当你首次对一名角色发动"飞军"时,你摸两张牌。
//
// 验证清单:
//   1. 选项1(给牌):两选项均有效 → chooseOption → 目标给牌 + 兵略摸2
//   2. 选项2(弃装备):两选项均有效 → chooseOption → 目标弃装备 + 兵略摸2
//   3. 仅选项1有效:自动选定 → 无 chooseOption pending → 目标给牌
//   4. 仅选项2有效:自动选定 → 无 chooseOption pending → 目标弃装备
//   5. 多目标选择:3人 → choosePlayer → 目标给牌
//   6. 兵略不重复:同目标第二次(跨回合)→ 不再摸2
//   7. 兵略不同目标:新目标 → 再次摸2
//   8. 限一次:本回合已用 → 再次被拒
//   9. 代价牌弃入弃牌堆
//   10. 负面-非自己回合 → 拒绝
//   11. 负面-无手牌作代价 → 拒绝
//   12. 超时兜底-给牌:目标不选 → 自动交第一张
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, EquipSlot, GameState, PlayerState } from '../../src/engine/types';

// 注册飞军/兵略(测试注入,见 lifecycle.setSkillModuleOverride)
setSkillModuleOverride('飞军', async () => await import('../../src/engine/skills/飞军'));
setSkillModuleOverride('兵略', async () => await import('../../src/engine/skills/兵略'));

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
    character: opts.character ?? '王平',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['飞军', '兵略'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('飞军 + 兵略', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 选项1(给牌):两选项有效 → chooseOption ────────────────────

  it('选项1:弃代价 + chooseOption=hand → 目标给牌 + 兵略摸2', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          equipment: { 武器: 'w2' },
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
        w2: makeCard('w2', '诸葛弩', '♣', 'A', '装备牌'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 发动飞军:弃 c1
    await P1.useCard('飞军', 'c1');

    // 两选项有效 → P1 chooseOption pending
    P1.expectPending('请求回应');
    await P1.respond('飞军', { option: 'hand' });

    // 仅 P2 是候选 → 自动选定 → 兵略摸2 → P2 giveCard pending
    P2.expectPending('请求回应');

    // 记录兵略摸牌前 P1 手牌数(应为 c2 + 2张摸牌 = 3)
    expect(harness.state.players[0].hand).toHaveLength(3);
    expect(harness.state.players[0].hand).toContain('c2');

    // P2 选 t1 交给 P1
    await P2.respond('飞军', { cardId: 't1' });

    // 验证
    expect(harness.state.players[0].hand).toContain('t1'); // 获得 t1
    expect(harness.state.players[0].hand).toHaveLength(4); // c2 + 2摸牌 + t1
    expect(harness.state.players[1].hand).not.toContain('t1');
    expect(harness.state.players[1].hand).toHaveLength(2); // t2, t3
    expect(harness.state.zones.discardPile).toContain('c1'); // 代价牌弃入弃牌堆
    // 兵略记录首次目标
    expect(harness.state.players[0].vars['兵略/已飞军目标']).toContain(1);
    // 飞军限一次标记
    expect(harness.state.players[0].vars['飞军/usedThisTurn']).toBe(true);
  });

  // ─── 选项2(弃装备):两选项有效 → chooseOption ────────────────────

  it('选项2:弃代价 + chooseOption=equip → 目标弃装备 + 兵略摸2', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          equipment: { 武器: 'w2', 防具: 'a2' },
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
        w2: makeCard('w2', '诸葛弩', '♣', 'A', '装备牌'),
        a2: makeCard('a2', '仁王盾', '♣', '2', '装备牌'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 发动飞军:弃 c1
    await P1.useCard('飞军', 'c1');

    // 两选项有效 → chooseOption pending
    P1.expectPending('请求回应');
    await P1.respond('飞军', { option: 'equip' });

    // 兵略摸2 + P2 discardEquip pending
    P2.expectPending('请求回应');
    expect(harness.state.players[0].hand).toHaveLength(3); // c2 + 2摸牌

    // P2 选弃 w2
    await P2.respond('飞军', { cardId: 'w2' });

    // 验证:w2 弃入弃牌堆,P2 装备区只剩 a2
    expect(harness.state.zones.discardPile).toContain('w2');
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].equipment['防具']).toBe('a2');
    // 兵略记录
    expect(harness.state.players[0].vars['兵略/已飞军目标']).toContain(1);
  });

  // ─── 仅选项1有效:自动选定 ─────────────────────────────

  it('仅选项1有效:自动选定(无 chooseOption) → 目标给牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 发动飞军:弃 c1 → P1 有1手牌,P2 有3手牌(3>1 ✓),无人有装备(选项2无效)
    await P1.useCard('飞军', 'c1');

    // 选项1自动选定,目标自动选定 → 直接 P2 giveCard pending(无 chooseOption/choosePlayer)
    P2.expectPending('请求回应');
    await P2.respond('飞军', { cardId: 't1' });

    // P1 获得 t1
    expect(harness.state.players[0].hand).toContain('t1');
    expect(harness.state.players[1].hand).not.toContain('t1');
  });

  // ─── 仅选项2有效:自动选定 ─────────────────────────────

  it('仅选项2有效:自动选定(无 chooseOption) → 目标弃装备', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], equipment: { 武器: 'w1' } }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1'],
          equipment: { 武器: 'w2', 防具: 'a2' },
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        w1: makeCard('w1', '青龙偃月刀', '♠', '5', '装备牌'),
        w2: makeCard('w2', '诸葛弩', '♣', 'A', '装备牌'),
        a2: makeCard('a2', '仁王盾', '♣', '2', '装备牌'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 弃 c1 后有1手牌(c2),P2 有1手牌(1>1=false 选项1无效)
    // P1 有1装备,P2 有2装备(2>1 ✓ 选项2有效)
    await P1.useCard('飞军', 'c1');

    // 选项2自动选定,目标自动选定 → P2 discardEquip pending
    P2.expectPending('请求回应');
    await P2.respond('飞军', { cardId: 'a2' });

    // a2 弃入弃牌堆
    expect(harness.state.zones.discardPile).toContain('a2');
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
    expect(harness.state.players[1].equipment['武器']).toBe('w2');
  });

  // ─── 多目标选择:choosePlayer ─────────────────────────────

  it('多目标:3人 → choosePlayer → 选 P2 给牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P3',
          character: '刘备',
          hand: ['t4', 't5', 't6'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
        t4: makeCard('t4', '桃', '♦', '6'),
        t5: makeCard('t5', '杀', '♠', '8'),
        t6: makeCard('t6', '闪', '♣', '9'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 弃 c1 后有1手牌,P2/P3 各有3手牌(3>1 ✓),无人有装备
    // 选项1自动选定(唯一有效),P2 和 P3 均为候选 → choosePlayer pending
    await P1.useCard('飞军', 'c1');

    // P1 choosePlayer pending
    P1.expectPending('请求回应');
    await P1.respond('飞军', { targets: [1] }); // 选 P2

    // 兵略摸2 + P2 giveCard pending
    P2.expectPending('请求回应');
    await P2.respond('飞军', { cardId: 't1' });

    expect(harness.state.players[0].hand).toContain('t1');
    expect(harness.state.players[1].hand).not.toContain('t1');
    // 兵略记录 P2(非 P3)
    expect(harness.state.players[0].vars['兵略/已飞军目标']).toContain(1);
    expect(harness.state.players[0].vars['兵略/已飞军目标']).not.toContain(2);
  });

  // ─── 兵略不重复触发:同目标第二次(跨回合)────────────────

  it('兵略不重复:同目标跨回合第二次 → 不再摸2', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3', 't4', 't5', 't6'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
        t4: makeCard('t4', '桃', '♥', '6'),
        t5: makeCard('t5', '杀', '♠', '8'),
        t6: makeCard('t6', '闪', '♣', '9'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一次飞军 P2:P1 弃c1→1手牌, P2 有6张(6>1 ✓) → 选项1自动 → 兵略摸2 → P2给t1
    await P1.useCard('飞军', 'c1');
    await P2.respond('飞军', { cardId: 't1' });

    const handAfterFirst = harness.state.players[0].hand.length;
    // P1 = c2 + 2摸牌 + t1 = 4
    expect(handAfterFirst).toBe(4);
    expect(harness.state.players[0].vars['兵略/已飞军目标']).toContain(1);

    // 模拟新回合:清除 usedThisTurn
    delete harness.state.players[0].vars['飞军/usedThisTurn'];

    // 第二次飞军 P2(跨回合):P1 有4手牌弃1→3, P2 有5张(5>3 ✓)
    const costCard2 = harness.state.players[0].hand[0];
    await P1.useCard('飞军', costCard2);
    await P2.respond('飞军', { cardId: 't2' });

    // 兵略不触发:P1 弃1(-1) + 给牌+1 → handAfterFirst 不变
    expect(harness.state.players[0].hand).toHaveLength(handAfterFirst);
    expect(harness.state.players[0].hand).toContain('t2');
    // 兵略目标列表仍只有 P2(不重复)
    const binglueTargets = harness.state.players[0].vars['兵略/已飞军目标'] as number[];
    expect(binglueTargets.filter((t) => t === 1)).toHaveLength(1);
  });

  // ─── 兵略不同目标触发 ─────────────────────────────

  it('兵略不同目标:新目标 P3 → 再次摸2', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3', 't4', 't5', 't6'],
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P3',
          character: '刘备',
          hand: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
        t4: makeCard('t4', '桃', '♥', '6'),
        t5: makeCard('t5', '杀', '♠', '8'),
        t6: makeCard('t6', '闪', '♣', '9'),
        u1: makeCard('u1', '桃', '♦', 'Q'),
        u2: makeCard('u2', '杀', '♠', 'J'),
        u3: makeCard('u3', '闪', '♣', 'K'),
        u4: makeCard('u4', '桃', '♥', '7'),
        u5: makeCard('u5', '杀', '♦', '3'),
        u6: makeCard('u6', '闪', '♠', '4'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    // 第一次飞军 P2:P1 弃c1→1手牌, P2/P3 各6张(6>1 ✓) → choosePlayer
    await P1.useCard('飞军', 'c1');
    P1.expectPending('请求回应'); // choosePlayer (P2, P3 均候选)
    await P1.respond('飞军', { targets: [1] });
    P2.expectPending('请求回应'); // giveCard
    await P2.respond('飞军', { cardId: 't1' });

    expect(harness.state.players[0].vars['兵略/已飞军目标']).toContain(1);
    const handAfterFirst = harness.state.players[0].hand.length; // 4

    // 模拟新回合
    delete harness.state.players[0].vars['飞军/usedThisTurn'];

    // 第二次飞军 P3(不同目标):P1 弃1→3手牌, P2 有5张(5>3 ✓), P3 有6张(6>3 ✓)
    const costCard2 = harness.state.players[0].hand[0];
    await P1.useCard('飞军', costCard2);
    P1.expectPending('请求回应'); // choosePlayer
    await P1.respond('飞军', { targets: [2] }); // 选 P3
    P3.expectPending('请求回应'); // giveCard
    await P3.respond('飞军', { cardId: 'u1' });

    // 兵略触发:P3 是首次 → 摸2 → P1 弃1+兵略2+给牌1 = handAfterFirst+2
    expect(harness.state.players[0].vars['兵略/已飞军目标']).toContain(2);
    expect(harness.state.players[0].hand).toHaveLength(handAfterFirst + 2);
  });

  // ─── 限一次:本回合已用 → 再次被拒 ─────────────────────────────

  it('限一次:本回合已用 → 再次使用被拒(状态不变)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一次:成功
    await P1.useCard('飞军', 'c1');
    await P2.respond('飞军', { cardId: 't1' });
    expect(harness.state.players[0].vars['飞军/usedThisTurn']).toBe(true);

    // 记录当前状态
    const handBefore = harness.state.players[0].hand.length;

    // 第二次:被拒(validate 失败)
    const costCard2 = harness.state.players[0].hand[0];
    await P1.useCard('飞军', costCard2);

    // 状态不变(代价牌未被弃)
    expect(harness.state.players[0].hand).toHaveLength(handBefore);
  });

  // ─── 负面-非自己回合 → 拒绝 ─────────────────────────────

  it('负面:非自己回合 → 拒绝(状态不变)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;
    await P1.useCard('飞军', 'c1');

    // 状态不变
    expect(harness.state.players[0].hand).toHaveLength(handBefore);
    expect(harness.state.players[0].hand).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c1');
  });

  // ─── 负面-无手牌作代价 → 拒绝 ─────────────────────────────

  it('负面:无手牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          skills: [],
        }),
      ],
      cardMap: {
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('飞军', 'c1'); // c1 不在 P1 手牌中

    // 无效果
    expect(harness.state.players[0].vars['飞军/usedThisTurn']).toBeUndefined();
    expect(harness.state.zones.discardPile).toHaveLength(0);
  });

  // ─── 超时兜底-给牌:目标不选 → 自动交第一张 ────────────────────

  it('超时兜底:目标不回应给牌 → 自动交第一张手牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '7'),
        c2: makeCard('c2', '闪', '♥', '2'),
        t1: makeCard('t1', '桃', '♥', '5'),
        t2: makeCard('t2', '杀', '♣', '3'),
        t3: makeCard('t3', '闪', '♦', '4'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCard('飞军', 'c1');
    // 选项1自动选定,目标自动选定 → P2 giveCard pending
    P2.expectPending('请求回应');

    // P2 超时不回应
    await P2.pass();

    // 超时兜底:P2 自动交出手牌第一张(t1)
    expect(harness.state.players[0].hand).toContain('t1');
    expect(harness.state.players[1].hand).not.toContain('t1');
  });

  it('use prompt 投影下发 cardFilter candidates(filter 缺失回归)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const p1a = makeCard('p1a', '闪', '♥', '2');
    const p1b = makeCard('p1b', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['飞军'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1a', 'p1b'], skills: [] }),
      ],
      cardMap: { c1, p1a, p1b },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const use = P0.availableActions().find((a) => a.label === '飞军' && a.actionType === 'use');
    expect(use).toBeDefined();
    // 回归锚点:cardFilter 缺 filter 时前端/无头端拿不到选牌谓词
    // (use action 的 cardFilter 走 registry 路径,不注入投影 candidates)
    const cf = (use!.prompt as { cardFilter?: { filter?: unknown } }).cardFilter;
    expect(typeof cf?.filter).toBe('function');
    expect(P0.findValidCard('use')).not.toBeNull();
  });
});
