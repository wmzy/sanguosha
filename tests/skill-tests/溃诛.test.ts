// 孙亮(吴·风林火山,OL hero/403)技能测试:溃诛 + 掣政 + 立军
//
// 溃诛(被动技):弃牌阶段结束时二选一(摸牌/伤害),X=本阶段弃牌数。
// 掣政(锁定技):防止出牌阶段对攻击范围不含自己的角色造伤;用牌不足则弃他人牌。
// 立军(主公技):其他吴角色用杀后可交给主公,主公可令其摸牌+杀次+1。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import * as 溃诛Module from '../../src/engine/skills/溃诛';
import * as 掣政Module from '../../src/engine/skills/掣政';
import * as 立军Module from '../../src/engine/skills/立军';
import { applyAtom } from '../../src/engine/core/apply';
import { runDamageFlow } from '../../src/engine/flows/damage';
import { slashMax } from '../../src/engine/rules/slash-quota';
import { createGameState, suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

// 本地注册技能模块(主 agent 统一在 skills/index.ts 注册;测试本地兜底)
setSkillModuleOverride('溃诛', async () => 溃诛Module);
setSkillModuleOverride('掣政', async () => 掣政Module);
setSkillModuleOverride('立军', async () => 立军Module);

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
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  faction?: '魏' | '蜀' | '吴' | '群';
  identity?: '主公' | '忠臣' | '反贼' | '内奸';
  equipment?: PlayerState['equipment'];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? opts.maxHealth ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction,
    identity: opts.identity,
  };
}

/** 模拟弃牌阶段:弃置指定牌 + 触发阶段结束(弃牌) */
async function simulateDiscardPhase(
  harness: SkillTestHarness,
  player: number,
  cardIds: string[],
): Promise<void> {
  await applyAtom(harness.state, { type: '弃置', player, cardIds });
  void applyAtom(harness.state, { type: '阶段结束', player, phase: '弃牌' });
  await harness.waitForStable();
}

// ============================ 溃诛 ============================
describe('溃诛', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('选项1(摸牌):X=2,选 2 名角色各摸 1 张', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const c3 = mkCard('c3', '桃');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2', 'c3'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2, c3 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2']);
    SL.expectPending('请求回应');
    // 第一步:选「摸牌」
    await SL.respond('溃诛', { option: '摸牌' });
    // 第二步:选 2 名角色
    SL.expectPending('请求回应');
    await SL.respond('溃诛', { targets: [1, 2] });

    // P1、P2 各摸 1 张
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
  });

  it('选项1(摸牌):选 1 名角色(X=2,至多 2 名)', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2']);
    await SL.respond('溃诛', { option: '摸牌' });
    await SL.respond('溃诛', { targets: [1] });

    // 只 P1 摸 1 张
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(0);
  });

  it('选项2(伤害):X=2,选体力值之和为 2 的角色造成 1 点伤害', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 2, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2']);
    await SL.respond('溃诛', { option: '伤害' });
    // P1 体力 2,单独选之:体力值之和 = 2 = X
    await SL.respond('溃诛', { targets: [1] });

    // P1 受 1 点伤害:2 → 1
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[2].health).toBe(3);
  });

  it('选项2(伤害):选 2 名体力值各 2 的角色,和为 4 = X', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const c3 = mkCard('c3', '桃');
    const c4 = mkCard('c4', '酒');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2', 'c3', 'c4'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 2, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: [], health: 2, maxHealth: 3 }),
      ],
      cardMap: { c1, c2, c3, c4 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2', 'c3', 'c4']);
    await SL.respond('溃诛', { option: '伤害' });
    // P1(2) + P2(2) = 4 = X,各受 1 点
    await SL.respond('溃诛', { targets: [1, 2] });

    // 两名角色都受 1 点伤害(均未死)
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[2].health).toBe(1);
  });

  it('不发动:选「不发动」→ 无效果', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2']);
    SL.expectPending('请求回应');
    await SL.respond('溃诛', { option: '不发动' });

    // 无效果:P1 手牌不变
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.players[1].health).toBe(3);
  });

  it('负面:本阶段未弃牌(X=0)→ 不触发(无 pending)', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: [], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '弃牌' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('校验:伤害选项体力值之和≠X → 拒绝', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2']);
    await SL.respond('溃诛', { option: '伤害' });
    // X=2, P1 体力 3 ≠ 2 → 拒绝
    await SL.expectRejected({
      skillId: '溃诛',
      actionType: 'respond',
      params: { targets: [1] },
    });
  });

  it('校验:选项非法 → 拒绝', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2']);
    SL.expectPending('请求回应');
    await SL.expectRejected({
      skillId: '溃诛',
      actionType: 'respond',
      params: { option: 'invalid' },
    });
  });
});

// ============================ 掣政 ============================
describe('掣政', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('防止伤害:出牌阶段对攻击范围不含自己的角色(P2,距离 2)造伤 → 防止', async () => {
    // 4 人环形:P0↔P1=1, P0↔P3=1, P0↔P2=2。P2 攻击范围 1 < 距离 2 → 不含 P0。
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', skills: ['掣政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', health: 3, maxHealth: 3 }),
        mkPlayer({ index: 3, name: 'P3', health: 3, maxHealth: 3 }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 孙亮对 P2 造成 1 点伤害 → 防止(P2 攻击范围不含孙亮)
    void runDamageFlow(harness.state, 0, 2, 1);
    await waitForStable(harness.state);

    expect(harness.state.players[2].health).toBe(3); // 未扣血
  });

  it('不防止:出牌阶段对攻击范围含自己的角色(P1,距离 1)造伤 → 正常受伤', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', skills: ['掣政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', health: 3, maxHealth: 3 }),
        mkPlayer({ index: 3, name: 'P3', health: 3, maxHealth: 3 }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 孙亮对 P1 造成 1 点伤害 → P1 攻击范围含孙亮 → 正常受伤
    void runDamageFlow(harness.state, 0, 1, 1);
    await waitForStable(harness.state);

    expect(harness.state.players[1].health).toBe(2); // 扣 1 血
  });

  it('非出牌阶段伤害不防止:弃牌阶段对 P2 造伤 → 正常受伤', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', skills: ['掣政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', health: 3, maxHealth: 3 }),
        mkPlayer({ index: 3, name: 'P3', health: 3, maxHealth: 3 }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);

    // 弃牌阶段(非出牌阶段)→ 掣政不防止
    void runDamageFlow(harness.state, 0, 2, 1);
    await waitForStable(harness.state);

    expect(harness.state.players[2].health).toBe(2); // 正常扣血
  });

  it('用牌不足惩罚:出牌阶段用 0 张 < 1 名远处角色 → 自动弃其一张牌', async () => {
    const c1 = mkCard('c1', '杀');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', skills: ['掣政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: ['c1'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 3, name: 'P3', health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P2 是唯一攻击范围不含孙亮且有牌的角色(距离 2)。用牌 0 < 1 → 自动弃 P2 的牌。
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();

    // P2 的手牌被弃
    expect(harness.state.players[2].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  it('用牌足够:出牌阶段用 1 张 >= 1 名远处角色 → 无惩罚', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1'], skills: ['掣政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: ['c2'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 3, name: 'P3', health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 先模拟"使用一张牌":直接触发 使用时 atom(掣政计数)
    await applyAtom(harness.state, { type: '使用时', source: 0, cardId: 'c1' });
    // 出牌数 = 1 >= 1 名远处角色 → 无惩罚
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();

    // P2 的手牌未被弃
    expect(harness.state.players[2].hand).toEqual(['c2']);
  });
});

// ============================ 立军 ============================
describe('立军', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('触发:吴盟友用杀后交给主公 → 主公令其摸牌+杀次+1', async () => {
    const slash = mkCard('c1', '杀', '♠');
    const d1 = mkCard('d1', '闪', '♥');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '孙亮',
          skills: ['立军'],
          health: 3,
          maxHealth: 3,
          faction: '吴',
          identity: '主公',
        }),
        mkPlayer({
          index: 1,
          name: 'P1',
          hand: ['c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
          faction: '吴',
        }),
        mkPlayer({ index: 2, name: 'P2', health: 3, maxHealth: 3, faction: '群' }),
      ],
      cardMap: { c1: slash, d1 },
      zones: { deck: ['d1'], processing: [], discardPile: [] },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const SL = harness.player('孙亮');

    // P1 出杀打 P2(P2 无闪 → 闪询问自动跳过 → 杀结算 → 立军触发)
    await P1.useCardAndTarget('杀', 'c1', [2]);

    // 使用结算结束后 → 立军:问 P1 是否交给主公
    P1.expectPending('请求回应');
    await P1.respond('立军', { choice: true });

    // 杀卡已到孙亮手牌
    expect(harness.state.players[0].hand).toContain('c1');
    // 问主公是否令其摸牌+杀次+1
    SL.expectPending('请求回应');
    await SL.respond('立军', { choice: true });

    // P1 摸了 1 张(d1)
    expect(harness.state.players[1].hand).toEqual(['d1']);
    // 杀次 +1 标志已设
    expect(harness.state.turn.vars['立军/quota/1']).toBe(true);
    // slashMax 反映 +1(基础 1 + 立军 1 = 2)
    expect(slashMax(harness.state, 1)).toBe(2);
    // P2 受了 1 点伤害
    expect(harness.state.players[2].health).toBe(2);
  });

  it('盟友拒绝交牌:无转移、无加成', async () => {
    const slash = mkCard('c1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '孙亮',
          skills: ['立军'],
          health: 3,
          maxHealth: 3,
          faction: '吴',
          identity: '主公',
        }),
        mkPlayer({
          index: 1,
          name: 'P1',
          hand: ['c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
          faction: '吴',
        }),
        mkPlayer({ index: 2, name: 'P2', health: 3, maxHealth: 3, faction: '群' }),
      ],
      cardMap: { c1: slash },
      zones: { deck: [], processing: [], discardPile: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'c1', [2]);

    // P1 拒绝交牌
    P1.expectPending('请求回应');
    await P1.respond('立军', { choice: false });

    // 杀卡留在弃牌堆(未交给孙亮)
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c1');
    // 无 quota 标志
    expect(harness.state.turn.vars['立军/quota/1']).toBeUndefined();
    // 但本回合已用标记已设(盟友这一次机会已消耗)
    expect(harness.state.turn.vars['立军/used/1']).toBe(true);
  });

  it('主公拒绝加成:卡已转移,但不摸牌不+杀次', async () => {
    const slash = mkCard('c1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '孙亮',
          skills: ['立军'],
          health: 3,
          maxHealth: 3,
          faction: '吴',
          identity: '主公',
        }),
        mkPlayer({
          index: 1,
          name: 'P1',
          hand: ['c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
          faction: '吴',
        }),
        mkPlayer({ index: 2, name: 'P2', health: 3, maxHealth: 3, faction: '群' }),
      ],
      cardMap: { c1: slash },
      zones: { deck: [], processing: [], discardPile: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const SL = harness.player('孙亮');

    await P1.useCardAndTarget('杀', 'c1', [2]);

    // P1 同意交牌
    await P1.respond('立军', { choice: true });
    // 孙亮拒绝加成
    await SL.respond('立军', { choice: false });

    // 杀卡已转移到孙亮
    expect(harness.state.players[0].hand).toContain('c1');
    // P1 未摸牌(手牌为空,杀已用出)
    expect(harness.state.players[1].hand).toEqual([]);
    // 无 quota 标志
    expect(harness.state.turn.vars['立军/quota/1']).toBeUndefined();
  });

  it('每回合限一次:同一盟友第二次用杀不再触发', async () => {
    const slash1 = mkCard('c1', '杀', '♠');
    const slash2 = mkCard('c2', '杀', '♥');
    const d1 = mkCard('d1', '桃', '♥');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '孙亮',
          skills: ['立军'],
          health: 3,
          maxHealth: 3,
          faction: '吴',
          identity: '主公',
        }),
        mkPlayer({
          index: 1,
          name: 'P1',
          hand: ['c1', 'c2'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
          faction: '吴',
        }),
        mkPlayer({ index: 2, name: 'P2', health: 3, maxHealth: 3, faction: '群' }),
      ],
      cardMap: { c1: slash1, c2: slash2, d1 },
      zones: { deck: ['d1'], processing: [], discardPile: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const SL = harness.player('孙亮');

    // 第一次出杀
    await P1.useCardAndTarget('杀', 'c1', [2]);
    await P1.respond('立军', { choice: true }); // 交牌
    await SL.respond('立军', { choice: true }); // 加成 → quota+1, slashMax=2

    // 第二次出杀(quota 允许:已用 1, 上限 2)
    await P1.useCardAndTarget('杀', 'c2', [2]);

    // 立军不再触发(本回合已用):无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // P2 第二次受伤
    expect(harness.state.players[2].health).toBe(1); // 3 - 1 - 1 = 1
  });

  it('负面:非主公座次 → 不触发(ownerId≠0)', async () => {
    // 孙亮在座次 1(非主公位):立军不应触发
    const slash = mkCard('c1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', health: 3, maxHealth: 3, faction: '吴' }),
        mkPlayer({
          index: 1,
          name: '孙亮',
          skills: ['立军'],
          health: 3,
          maxHealth: 3,
          faction: '吴',
        }),
        mkPlayer({
          index: 2,
          name: 'P2',
          hand: ['c1'],
          skills: ['杀'],
          health: 3,
          maxHealth: 3,
          faction: '吴',
        }),
        mkPlayer({ index: 3, name: 'P3', health: 3, maxHealth: 3, faction: '群' }),
      ],
      cardMap: { c1: slash },
      zones: { deck: [], processing: [], discardPile: [] },
      currentPlayerIndex: 2, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 'c1', [3]);

    // 孙亮不在主公位(座次 1)→ 立军不触发
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('校验:摸牌选项 targets 含重复座次 → 拒绝', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2']);
    await SL.respond('溃诛', { option: '摸牌' });
    SL.expectPending('请求回应');
    // [1,1]:同一角色被重复选择 → 拒绝(否则 P1 被摸 2 张)
    await SL.expectRejected({
      skillId: '溃诛',
      actionType: 'respond',
      params: { targets: [1, 1] },
    });
    expect(harness.state.players[1].hand.length).toBe(0);
    // 合法目标继续放行,不卡死
    await SL.respond('溃诛', { targets: [1, 2] });
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
  });

  it('校验:伤害选项 targets 含重复座次 → 拒绝', async () => {
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '孙亮', hand: ['c1', 'c2'], skills: ['溃诛'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 2, name: 'P2', hand: [], health: 3, maxHealth: 3 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const SL = harness.player('孙亮');

    await simulateDiscardPhase(harness, 0, ['c1', 'c2']);
    await SL.respond('溃诛', { option: '伤害' });
    // X=2。P1 体力 1 + P2 体力... [1,1] 重复:体力和=2 恰好等于 X,
    // 若无查重会被接受并使 P1 受两次伤 → 必须拒绝
    await SL.expectRejected({
      skillId: '溃诛',
      actionType: 'respond',
      params: { targets: [1, 1] },
    });
    expect(harness.state.players[1].health).toBe(1);
  });
});
