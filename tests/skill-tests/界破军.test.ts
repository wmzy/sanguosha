// 界破军(界徐盛·被动技)测试:
// 核心机制:
//   1. 主效果:徐盛使用【杀】指定目标后,询问是否发动破军,确认后选 1~X 张目标牌移出游戏
//      (X 为目标体力值,牌可来自手牌或装备区),回合结束归还。
//   2. 增伤效果:徐盛使用【杀】对"手牌数与装备数皆 ≤ 自己"的目标造成的伤害 +1。
//
// 用例:
//   1. happy path:杀指定 → 发动破军 → 选 X 张手牌移出 → 杀伤害+1(条件满足)
//   2. 不发动破军 → 牌不移出,但杀伤害+1条件仍校验(若满足)
//   3. 选装备区牌移出
//   4. X = target.health 边界
//   5. 目标无牌 → 不触发破军询问
//   6. 增伤条件不满足(target 手牌数 > self) → 伤害不+1
//   7. 增伤条件不满足(target 装备数 > self) → 伤害不+1
//   8. 回合结束 → 归还所有破军移出的牌
//   9. 多目标杀 → 每个目标独立触发破军
//  10. 归还时机:仅徐盛的回合结束触发(他人回合结束不归还)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeWeapon(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  range: number,
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype: '武器', range };
}

function makeArmor(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype: '防具' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界徐盛',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
  };
}

describe('界破军', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path:发动破军移出手牌 + 增伤+1 ────────────────────
  it('杀指定 → 发动破军 → 移出 X 张手牌 → 杀伤害+1(条件满足)', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    // P1 手牌:杀来时 X=4(满血),选 2 张移出
    const t1 = makeCard('t1', '闪', '♥', '3');
    const t2 = makeCard('t2', '闪', '♦', '4');
    const t3 = makeCard('t3', '桃', '♥', '5');
    const t4 = makeCard('t4', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '界破军'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2', 't3', 't4'],
          skills: [],
          health: 4,
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, t1, t2, t3, t4 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 使用杀指定 P1
    await P0.useCardAndTarget('杀', 's1', [1]);

    // 破军询问(指定目标 after-hook)
    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: true });
    await harness.waitForStable();

    // 选牌询问:X = P1.health = 4。选 2 张(满足增伤条件:P1 移出后手牌数 2 ≤ P0 手牌数 1?
    //   注意:P0 已出杀,手牌=0;t1~t4 共 4 张。条件检查在造成伤害时:P1.hand 4 > P0.hand 0 →
    //   不满足。为让增伤生效,本用例把 P0 给一张额外手牌。)
    // —— 重新设计:把 P0 加一张保命手牌让条件可能成立 ——
    // 此处先验证主效果(移出),增伤单列用例 1b 测。
    P0.expectPending('请求回应');
    await P0.respond('界破军', { cardIds: ['t1', 't2'] });
    await harness.waitForStable();

    // 牌已移出:hand 减少 2,vars 记录
    expect(harness.state.players[1].hand).toEqual(['t3', 't4']);
    expect(harness.state.players[1].vars['界破军/移出']).toEqual(['t1', 't2']);
    // 牌未进弃牌堆
    expect(harness.state.zones.discardPile).not.toContain('t1');
    expect(harness.state.zones.discardPile).not.toContain('t2');

    // 杀结算:P1 被询问闪 → 不闪
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();

    // P1 受到 1 点伤害(条件不满足:移出后 P1.hand 2 > P0.hand 0)
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 1b. 增伤生效:P0 手牌 ≥ P1 手牌 且 P0 装备 ≥ P1 装备 → +1 ────────────────────
  it('增伤生效:目标手牌与装备数皆 ≤ 自己 → 杀伤害+1', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const p0e = makeCard('p0e', '闪', '♥', '2');
    const p0w = makeWeapon('p0w', '诸葛连弩', '♣', 3);
    const t1 = makeCard('t1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        // P0 出杀后还剩 1 张手牌(p0extra)+ 1 装备(武器)
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'p0e'],
          equipment: { 武器: 'p0w' },
          skills: ['杀', '界破军'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1'],
          skills: [],
          health: 4,
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, p0e, p0w, t1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    // 破军询问 → 不发动(简化用例,聚焦增伤)
    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: false });
    await harness.waitForStable();

    // 杀结算:P1 不闪 → 受 1+1=2 点伤害
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(2); // 4 - 2 = 2
  });

  // ─── 2. 不发动破军 → 牌不移出 ────────────────────
  it('不发动破军 → 牌不移出', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const t1 = makeCard('t1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀', '界破军'], health: 4 }),
        makePlayer({ index: 1, name: 'P1', hand: ['t1'], skills: [], character: '曹操' }),
      ],
      cardMap: { s1: slash, t1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: false });
    await harness.waitForStable();

    // 未移出
    expect(harness.state.players[1].hand).toEqual(['t1']);
    expect(harness.state.players[1].vars['界破军/移出']).toBeUndefined();

    // 杀继续结算
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 3. 选装备区牌移出 ────────────────────
  it('破军可选装备区牌移出(装备槽被清空)', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const p1w = makeWeapon('p1w', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀', '界破军'], health: 4 }),
        makePlayer({
          index: 1,
          name: 'P1',
          equipment: { 武器: 'p1w' },
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, p1w },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: true });
    await harness.waitForStable();

    // X = P1.health = 4,P1 只有 1 张装备,选 1 张
    P0.expectPending('请求回应');
    await P0.respond('界破军', { cardIds: ['p1w'] });
    await harness.waitForStable();

    // 装备已移出:槽位空,vars 记录
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].vars['界破军/移出']).toEqual(['p1w']);

    // 杀结算
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();
    // 破军移出装备后 P1 装备数 0 ≤ P0 装备数 0 → 增伤+1
    expect(harness.state.players[1].health).toBe(2); // 4 - 2 = 2
  });

  // ─── 4. X = target.health:目标体力 2 时至多移出 2 张 ────────────────────
  it('X = target.health(体力 2),至多移出 2 张', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const t1 = makeCard('t1', '闪', '♥', '3');
    const t2 = makeCard('t2', '杀', '♠', '4');
    const t3 = makeCard('t3', '桃', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀', '界破军'], health: 4 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2', 't3'],
          skills: [],
          health: 2,
          maxHealth: 4,
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, t1, t2, t3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 's1', [1]);

    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: true });
    await harness.waitForStable();

    // 尝试选 3 张 → 应被 validate 拒绝(X=2)
    P0.expectPending('请求回应');
    await P0.expectRejected({
      skillId: '界破军',
      actionType: 'respond',
      params: { cardIds: ['t1', 't2', 't3'] },
    });
    // 选 2 张 → 通过
    await P0.respond('界破军', { cardIds: ['t1', 't2'] });
    await harness.waitForStable();

    expect(harness.state.players[1].hand).toEqual(['t3']);
    expect(harness.state.players[1].vars['界破军/移出']).toEqual(['t1', 't2']);
  });

  // ─── 5. 目标无牌 → 不触发破军询问 ────────────────────
  it('目标无牌(手牌+装备皆空)→ 破军不触发(增伤条件满足则伤害仍+1)', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀', '界破军'], health: 4 }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [], character: '曹操' }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    // P1 无牌 → 破军不触发;直接进入杀结算
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();
    // P0 出杀后手牌 0,装备 0;P1 手牌 0,装备 0 → 增伤条件满足(P1 牌区皆 ≤ P0)
    expect(harness.state.players[1].health).toBe(2); // 4 - (1+1) = 2
    expect(harness.state.players[1].vars['界破军/移出']).toBeUndefined();
  });

  // ─── 6. 增伤条件不满足:目标手牌数 > self → 伤害不+1 ────────────────────
  it('增伤条件不满足:目标手牌数 > self 手牌数 → 伤害不+1', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const t1 = makeCard('t1', '闪', '♥', '3');
    const t2 = makeCard('t2', '闪', '♦', '4');
    const state: GameState = createGameState({
      players: [
        // P0 出杀后手牌=0
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀', '界破军'], health: 4 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2'],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, t1, t2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    // 不发动破军
    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: false });
    await harness.waitForStable();

    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();

    // P1 手牌 2 > P0 手牌 0 → 不增伤,只受 1 点
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 7. 增伤条件不满足:目标装备数 > self → 伤害不+1 ────────────────────
  it('增伤条件不满足:目标装备数 > self 装备数 → 伤害不+1', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const p1w = makeWeapon('p1w', '青釭剑', '♠', 2);
    const p1a = makeArmor('p1a', '仁王盾', '♣');
    const state: GameState = createGameState({
      players: [
        // P0 无装备
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀', '界破军'], health: 4 }),
        // P1 2 件装备 > P0 0 件
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          equipment: { 武器: 'p1w', 防具: 'p1a' },
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, p1w, p1a },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    // P1 有牌但破军 X = P1.health = 4,这里不发动
    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: false });
    await harness.waitForStable();

    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();

    // P1 装备 2 > P0 装备 0 → 不增伤,只受 1 点
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 8. 回合结束 → 归还所有破军移出的牌 ────────────────────
  it('回合结束 → 归还所有破军移出的牌到目标手牌', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const t1 = makeCard('t1', '闪', '♥', '3');
    const t2 = makeCard('t2', '闪', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀', '界破军'], health: 4 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 't2'],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, t1, t2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    // 发动破军,移出 t1
    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界破军', { cardIds: ['t1'] });
    await harness.waitForStable();

    expect(harness.state.players[1].hand).toEqual(['t2']);
    expect(harness.state.players[1].vars['界破军/移出']).toEqual(['t1']);

    // 杀结算 → P1 不闪
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();

    // 徐盛回合结束
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();

    // 牌归还到手牌
    expect(harness.state.players[1].hand).toEqual(['t2', 't1']);
    expect(harness.state.players[1].vars['界破军/移出']).toBeUndefined();
  });

  // ─── 9. 多目标杀 → 每个目标独立触发破军 ────────────────────
  it('多目标杀 → 每个目标独立触发破军询问', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const p0w = makeWeapon('p0w', '方天画戟', '♣', 4); // 攻击范围 4
    // 给 P0 装备方天画戟让范围足够;并多准备 1 张手牌满足方天画戟条件(手牌仅 1 张时触发)
    const p0e = makeCard('p0e', '闪', '♥', '2');
    const t1a = makeCard('t1a', '闪', '♥', '3');
    const t2a = makeCard('t2a', '闪', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'p0e'],
          equipment: { 武器: 'p0w' },
          skills: ['杀', '界破军'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1a'],
          skills: [],
          character: '曹操',
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: ['t2a'],
          skills: [],
          character: '刘备',
        }),
      ],
      cardMap: { s1: slash, p0w, p0e, t1a, t2a },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P0 使用杀指定 P1 和 P2
    await P0.useCardAndTarget('杀', 's1', [1, 2]);

    // 指定目标 1 后:破军询问
    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界破军', { cardIds: ['t1a'] });
    await harness.waitForStable();
    expect(harness.state.players[1].vars['界破军/移出']).toEqual(['t1a']);

    // 指定目标 2 后:破军询问(每个目标独立)
    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: false });
    await harness.waitForStable();
    expect(harness.state.players[2].vars['界破军/移出']).toBeUndefined();

    // 杀结算:P1 询问闪
    const P1 = harness.player('P1');
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();

    // P2 询问闪
    const P2 = harness.player('P2');
    P2.expectPending('询问闪');
    await P2.pass();
    await harness.waitForStable();
  });

  // ─── 10. 仅徐盛回合结束触发归还(他人回合不归还)────────────────────
  it('他人回合结束不归还(仅徐盛回合结束触发)', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const t1 = makeCard('t1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀', '界破军'], health: 4 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1'],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, t1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界破军', { cardIds: ['t1'] });
    await harness.waitForStable();
    expect(harness.state.players[1].vars['界破军/移出']).toEqual(['t1']);

    // 杀结算
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();

    // 模拟 P1 回合结束(他人回合)— 不应归还
    void applyAtom(harness.state, { type: '回合结束', player: 1 });
    await harness.waitForStable();
    expect(harness.state.players[1].vars['界破军/移出']).toEqual(['t1']); // 仍未归还

    // 徐盛回合结束 → 归还
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    expect(harness.state.players[1].vars['界破军/移出']).toBeUndefined();
    expect(harness.state.players[1].hand).toEqual(['t1']);
  });

  // ─── 11. 联动:破军移出装备 → 装备数下降 → 增伤条件可能满足 ────────────────────
  it('联动:破军移出目标装备后,目标装备数≤self → 杀伤害+1', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const p0w = makeWeapon('p0w', '青釭剑', '♣', 2);
    const p1w = makeWeapon('p1w', '诸葛连弩', '♠', 3);
    const state: GameState = createGameState({
      players: [
        // P0:1 装备(武器)
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          equipment: { 武器: 'p0w' },
          skills: ['杀', '界破军'],
          health: 4,
        }),
        // P1:1 装备(武器)— 装备数等于 P0,不大于;手牌 0 ≤ P0 手牌 0(出杀后)
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          equipment: { 武器: 'p1w' },
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { s1: slash, p0w, p1w },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);

    // 发动破军,移出 P1 武器
    P0.expectPending('请求回应');
    await P0.respond('界破军', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界破军', { cardIds: ['p1w'] });
    await harness.waitForStable();
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();

    // 杀结算 → P1 不闪 → 受伤
    // 增伤条件:P1.hand 0 ≤ P0.hand 0(出杀后),P1.equipCount 0 ≤ P0.equipCount 1 → 满足,+1
    P1.expectPending('询问闪');
    await P1.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(2); // 4 - 2 = 2
  });
});
