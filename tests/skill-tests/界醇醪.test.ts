// 界醇醪(界程普·吴·被动技)测试
//   你或你相邻角色的【杀】因弃置置入弃牌堆后,将之置于你的武将牌上,称为"醇"。
//   当一名角色处于濒死状态时,你可以移去X张"醇"视为其使用一张【酒】
//   (X为本轮以此法使用【酒】的次数)。
//
// 官方来源:三国杀 OL 界限突破 hero/620。
//
// 验证:
//   1. 存醇:owner 弃杀 → 加入醇列表
//   2. 存醇:相邻角色弃杀 → 加入醇列表(双人局互为相邻)
//   3. 存醇:非相邻角色弃杀 → 不加入
//   4. 存醇:弃非杀(桃/闪)→ 不加入
//   5. 存醇:重复弃同一杀 id 不重复入库
//   6. 用醇 X=1:首次使用,移去 1 张醇 → 视为酒 → 救回
//   7. 用醇 X=2:同轮第二次使用,需 2 张醇
//   8. 用醇:轮次切换后 X 重置为 1
//   9. 用醇 reject:醇数不足 X 时被拒
//  10. 用醇 reject:无求桃 pending 时被拒
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

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  faction?: '魏' | '蜀' | '吴' | '群';
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界程普',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction ?? '吴',
  };
}

/** 取 owner 的醇列表(测试辅助) */
function 醇列表(state: GameState, ownerId: number): string[] {
  const v = state.players[ownerId].vars['醇醪/醇'];
  return Array.isArray(v) ? (v as string[]) : [];
}

describe('界醇醪', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 存醇:owner 弃杀 ─────────────────────────────

  it('存醇:owner 弃杀 → 加入醇列表', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接 applyAtom(弃置) 触发界醇醪 after-hook
    await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['s1'] });
    await harness.waitForStable();

    const list = 醇列表(harness.state, 0);
    expect(list).toContain('s1');
    // 杀物理上仍在弃牌堆(只是被 earmark 为醇)
    expect(harness.state.zones.discardPile).toContain('s1');
  });

  // ─── 2. 存醇:相邻角色弃杀 ─────────────────────────────

  it('存醇:相邻角色(P1)弃杀 → 加入 P0 醇列表(双人局互为相邻)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['s1'], skills: ['闪'] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['s1'] });
    await harness.waitForStable();

    const list = 醇列表(harness.state, 0);
    expect(list).toContain('s1');
  });

  // ─── 3. 存醇:非相邻角色弃杀 ─────────────────────────────

  it('存醇:非相邻角色弃杀 → 不加入(四人局 P0 vs P2 不相邻)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['闪'] }),
        makePlayer({ index: 3, name: 'P3', hand: ['s1'], skills: ['闪'] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 四人局 P0 相邻:P3(左), P1(右)。P2 不相邻
    await applyAtom(harness.state, { type: '弃置', player: 2, cardIds: ['s1'] });
    await harness.waitForStable();

    const list = 醇列表(harness.state, 0);
    expect(list).not.toContain('s1');
  });

  // ─── 4. 存醇:弃非杀 ─────────────────────────────

  it('存醇:弃桃/闪 → 不加入醇列表', async () => {
    const peach = makeCard('p1', '桃', '♥', '5');
    const dodge = makeCard('d1', '闪', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['p1', 'd1'],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { p1: peach, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await applyAtom(harness.state, {
      type: '弃置',
      player: 0,
      cardIds: ['p1', 'd1'],
    });
    await harness.waitForStable();

    const list = 醇列表(harness.state, 0);
    expect(list).toEqual([]);
  });

  // ─── 6. 用醇 X=1:首次使用 ─────────────────────────────

  it('用醇 X=1:首次使用移去 1 张醇 → 视为酒 → 救回濒死者', async () => {
    const slashForDamage = makeCard('sd', '杀', '♠', 'A'); // P0 用于出杀造成伤害
    const slashFor醇 = makeCard('sc', '杀', '♠', '2'); // 用于弃置作醇
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slashForDamage.id],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['闪'],
          health: 1, // 1 血,中杀即濒死
        }),
      ],
      cardMap: { sd: slashForDamage, sc: slashFor醇 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 预置醇:把 sc 加到 P0 醇列表(模拟此前的存醇流程,避免依赖时序)
    // 先把 sc 加入 discardPile + 醇列表
    harness.state.zones.discardPile.push('sc');
    harness.state.players[0].vars['醇醪/醇'] = ['sc'];
    harness.rebuildViews();

    // P0 出杀打 P1(1血) → 濒死
    await P0.useCardAndTarget('杀', 'sd', [1]);
    // P1 不闪
    await P1.pass();
    // P1 HP=0 → 触发濒死 → 求桃询问轮到 P0
    expect(harness.state.players[1].health).toBe(0);
    // 求桃循环按座次从濒死者开始:P1 先被问(P1 无桃→超时),然后 P0 被问
    await P1.pass(); // P1 无桃/醇,放弃
    // 现在 P0 被问(P0 有醇醪)
    P0.expectPending('请求回应');
    // P0 用醇醪
    await P0.respond('界醇醪', {});

    // 醇被消耗,濒死者被救回(回复 1 体力)
    expect(harness.state.players[1].health).toBe(1);
    expect(醇列表(harness.state, 0)).toEqual([]);
    expect(harness.state.players[0].vars['醇醪/usedThisRound']).toBe(1);
  });

  // ─── 7. 用醇 X=2:同轮第二次使用,需 2 张醇 ────────────────────

  it('用醇 X=2:同轮第二次使用需 2 张醇 → 成功', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['闪'],
          health: 1,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 预置 3 张醇(足以 X=1 + X=2)
    harness.state.zones.discardPile.push('sc1', 'sc2', 'sc3');
    harness.state.players[0].vars['醇醪/醇'] = ['sc1', 'sc2', 'sc3'];
    harness.rebuildViews();

    // 第一次濒死:X=1,用 1 醇
    void applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
    });
    await harness.waitForStable();
    await P1.pass();
    await P0.respond('界醇醪', {});
    expect(harness.state.players[1].health).toBe(1);
    expect(醇列表(harness.state, 0)).toEqual(['sc2', 'sc3']); // 移去 1 张

    // 第二次濒死:X=2,用 2 醇
    void applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
    });
    await harness.waitForStable();
    await P1.pass();
    await P0.respond('界醇醪', {}); // X=2 需 2 醇,P0 有 2 醇 → 成功
    expect(harness.state.players[1].health).toBe(1);
    expect(醇列表(harness.state, 0)).toEqual([]); // 移去 2 张
    expect(harness.state.players[0].vars['醇醪/usedThisRound']).toBe(2);
  });

  // ─── 9. 用醇 reject:醇数不足 X 时被拒 ─────────────────────────────

  it('用醇 reject:醇数不足 X → 拒绝', async () => {
    // 制造 X=2 但只有 1 醇的场景:先成功用 1 次(X=1 用 1 醇),然后再次濒死但只剩 0 醇
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['闪'],
          health: 1,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 预置 1 张醇
    harness.state.zones.discardPile.push('sc');
    harness.state.players[0].vars['醇醪/醇'] = ['sc'];
    harness.rebuildViews();

    // 第一次濒死:直接造成伤害(P1 1血 → 0 → 濒死)→ 用 1 醇救回
    void applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
    });
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(0);
    // 求桃循环:P1 先被问
    await P1.pass();
    await P0.respond('界醇醪', {}); // 用 1 醇救(X=1)
    expect(harness.state.players[1].health).toBe(1);
    expect(醇列表(harness.state, 0)).toEqual([]);
    expect(harness.state.players[0].vars['醇醪/usedThisRound']).toBe(1);

    // 第二次濒死:再造成伤害
    void applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
    });
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(0);
    await P1.pass();
    // P0 被问 → 但 X=2 需要 2 醇,P0 有 0 醇 → reject
    await P0.expectRejected({
      skillId: '界醇醪',
      actionType: 'respond',
      params: {},
    });
    // 让 P0 超时(放弃)→ P1 未被救 → 击杀
    await P0.pass();
  });

  // ─── 10. 用醇 reject:无求桃 pending 时被拒 ─────────────────────────────

  it('用醇 reject:无求桃 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 预置醇
    harness.state.players[0].vars['醇醪/醇'] = ['fake醇'];
    harness.rebuildViews();

    // 无 pending → reject
    await P0.expectRejected({
      skillId: '界醇醪',
      actionType: 'respond',
      params: {},
    });
  });

  // ─── 8. 用醇:轮次切换后 X 重置为 1 ────────────────────

  it('用醇:轮次切换后 X 重置为 1', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界醇醪', '杀', '闪'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['闪'],
          health: 1,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 预置 3 张醇
    harness.state.zones.discardPile.push('sc1', 'sc2', 'sc3');
    harness.state.players[0].vars['醇醪/醇'] = ['sc1', 'sc2', 'sc3'];
    // 模拟第一轮用过 1 次(lastRound=1, usedThisRound=1)
    harness.state.players[0].vars['醇醪/usedThisRound'] = 1;
    harness.state.players[0].vars['醇醪/lastRound'] = 1;
    harness.rebuildViews();

    // 切换到第二轮(usedThisRound 仍为 1,但 computeX 会重置)
    harness.state.turn.round = 2;
    harness.rebuildViews();

    // 濒死:P0 用醇 · computeX 发现 lastRound(1) ≠ currentRound(2) → 重置 → X=1
    void applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
    });
    await harness.waitForStable();
    await P1.pass();
    await P0.respond('界醇醪', {}); // 若 X=2 需 2 醇,但 X 重置为 1 → 只需 1 醇 → 成功
    expect(harness.state.players[1].health).toBe(1);
    expect(醇列表(harness.state, 0)).toEqual(['sc2', 'sc3']); // 只移去 1 张(X=1)
    // usedThisRound 被重置为 0 后又 +1 = 1
    expect(harness.state.players[0].vars['醇醪/usedThisRound']).toBe(1);
    expect(harness.state.players[0].vars['醇醪/lastRound']).toBe(2);
  });
});
