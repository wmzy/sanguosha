// 界献州(界蔡夫人·群·限定技)测试:
//   限定技:出牌阶段,将自己装备区所有牌交给一名其他角色,
//   其选择 1.令你回复X体力;2.对其攻击范围内至多X名角色各造成1伤害。(X=装备数)
//
// 验证:
//   1. happy path(回血):owner 交出 2 张装备 → 目标选回血 → owner 回 2 血
//   2. happy path(造伤):目标选造伤 → 选至多 X 名攻击范围内角色 → 各受 1 伤
//   3. 造伤选 0 名(放弃):目标放弃造伤,无伤害发生
//   4. 限定技已使用 → 第二次发动被拒绝
//   5. 装备区无牌 → 拒绝
//   6. 目标是自己 → 拒绝
//   7. 非出牌阶段/非自己回合 → 拒绝
//   8. 交出武器后,owner 出杀范围正确回到 1(距离 vars 清理)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
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
): Card {
  return { id, name, suit, color: suitColor(suit), rank: 'A', type: '装备牌', subtype: '防具' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: PlayerState['equipment'];
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界蔡夫人',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界献州', '界窃听'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界献州', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path(回血):交出 2 张装备 → 目标选回血 → owner 回 2 血 ────
  it('happy path(回血):交出 2 张装备 → owner 回 2 血', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const armor = makeArmor('a1', '八卦阵', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 1, // 残血,验证回复
          maxHealth: 3,
          equipment: { 武器: 'w1', 防具: 'a1' },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: weapon, a1: armor },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界献州', 'use', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 装备已交出
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].equipment['防具']).toBeUndefined();
    expect(harness.state.players[1].hand).toContain('w1');
    expect(harness.state.players[1].hand).toContain('a1');

    // P1 被问选 1(回血)/2(造伤)→ 选回血(choice=true)
    const P1 = harness.player('P1');
    P1.expectPending('请求回应');
    await P1.respond('界献州', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // owner 回 2 血(1 → 3)
    expect(harness.state.players[0].health).toBe(3);
    // 限定技已使用标记
    expect(harness.state.players[0].vars['界献州/used']).toBe(true);
  });

  // ─── 2. happy path(造伤):目标选造伤 → 选 1 名范围内角色 → 受 1 伤 ────
  it('happy path(造伤):目标选造伤 → 选至多 X 名角色 → 各受 1 伤', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 2,
          maxHealth: 3,
          equipment: { 武器: 'w1' },
        }),
        // P1 接收装备 + 造伤来源;P1 装备丈八蛇矛(range=3)覆盖 P2(距离 2)
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          equipment: {},
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界献州', 'use', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 装备已交出,P1 现手牌含 w1
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].hand).toContain('w1');

    // P1 选造伤(choice=false)
    const P1 = harness.player('P1');
    P1.expectPending('请求回应');
    await P1.respond('界献州', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 选至多 1 名攻击范围内角色。P1 装备已含 w1(刚接收,range=2);
    // 但描述说"其攻击范围"——P1 接收装备后,其攻击范围受该装备影响。
    // P1 当前手中已有 w1(刚接收),但还未装备,默认 range=1。
    // P0 距离 P1 = 1,P2 距离 P1 = 1(三人环座),都在范围内。
    P1.expectPending('请求回应');
    // 选 P0 作为造伤目标
    await P1.respond('界献州', { targets: [0] });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 受 1 点伤害(来源 P1)。初始 2 → 1
    expect(harness.state.players[0].health).toBe(1);
    // P2 未受伤
    expect(harness.state.players[2].health).toBe(4);
    expect(harness.state.players[0].vars['界献州/used']).toBe(true);
  });

  // ─── 3. 造伤选 0 名(放弃) ───────────────────────────────
  it('造伤路径选 0 名 → 无伤害', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 2,
          maxHealth: 3,
          equipment: { 武器: 'w1' },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界献州', 'use', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    const P1 = harness.player('P1');
    await P1.respond('界献州', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 选 0 名目标
    P1.expectPending('请求回应');
    await P1.respond('界献州', { targets: [] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无伤害发生
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].vars['界献州/used']).toBe(true);
  });

  // ─── 4. 限定技已使用 → 拒绝 ─────────────────────────────
  it('限定技已使用 → 第二次被拒绝', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const weapon2 = makeWeapon('w2', '丈八蛇矛', '♠', 3);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 2,
          maxHealth: 3,
          equipment: { 武器: 'w1' },
          // 标记已使用
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: weapon, w2: weapon2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    // 手动标记限定技已使用
    harness.state.players[0].vars['界献州/used'] = true;
    harness.rebuildViews();

    const P0 = harness.player('P0');
    await P0.expectRejected({
      skillId: '界献州',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 5. 装备区无牌 → 拒绝 ──────────────────────────────
  it('装备区无牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', health: 2, maxHealth: 3, hand: ['c1'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: makeCard('c1', '杀', '♠') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界献州',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 6. 目标是自己 → 拒绝 ──────────────────────────────
  it('目标是自己 → 拒绝', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          equipment: { 武器: 'w1' },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界献州',
      actionType: 'use',
      params: { target: 0 },
    });
  });

  // ─── 7. 非自己回合 → 拒绝 ──────────────────────────────
  it('非自己回合 → 拒绝', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          equipment: { 武器: 'w1' },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界献州',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 8. 交出武器后,owner 出杀范围回到 1(距离 vars 清理) ────
  it('交出武器后 owner vars 距离/出杀范围 被清理', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 2,
          maxHealth: 3,
          equipment: { 武器: 'w1' },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 初始有距离/出杀范围(手动设置,模拟装备流程已设值)
    harness.state.players[0].vars['距离/出杀范围'] = 2;
    harness.rebuildViews();
    expect(harness.state.players[0].vars['距离/出杀范围']).toBe(2);

    await P0.triggerAction('界献州', 'use', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 装备交出 → 距离 vars 清理(由 卸下 atom 处理)
    expect(harness.state.players[0].vars['距离/出杀范围']).toBeUndefined();

    // 完成询问(P1 选回血)
    const P1 = harness.player('P1');
    await P1.respond('界献州', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
  });
});
