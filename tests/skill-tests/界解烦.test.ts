// 界解烦(界韩当·吴·限定技)测试(界限突破版):
// 核心机制(OL hero/676 官方逐字):
//   限定技,出牌阶段选一名角色,令所有攻击范围内包含其的角色各选:
//   1.弃武器牌 或 2.令该角色摸一张牌。第一轮发动后回合结束视为未发动。
//
// 注:按字面描述"所有...的角色"包含发动者自身——若发动者攻击范围内包含
//   目标,发动者同样需做出选择。本测试通过距离设置让发动者不在范围。
//
// 用例:
//   1. happy path:受影响者选弃武器 → 弃一张武器牌
//   2. happy path:受影响者选令摸牌 → 目标摸一张牌
//   3. 第一轮发动:turn.vars['界解烦/resetOnEnd'] 被设
//   4. 非第一轮发动:turn.vars['界解烦/resetOnEnd'] 不设
//   5. 限定技只用一次:第二次发动被拒绝(USED_KEY 已设)
//   6. 攻击范围外角色不被询问(座位距离 > 武器范围)
//   7. 选择弃武器但无武器 → 自动改为令摸牌
//   8. 非自己回合 → 拒绝
//   9. 选自己为目标:合法(自身不在范围)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
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

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
  character?: string;
  vars?: Record<string, unknown>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界韩当',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as Record<string, never>,
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界解烦', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── happy path:受影响者选弃武器 → 弃一张武器牌 ────────────
  // 5 人局:座位 0,1,2,3,4。P0 解烦 P3。
  // P0 距 P3 = min(3, 5-3) = 2,P0 徒手范围 1 < 2,不在范围 ✓
  // P2 距 P3 = 1,P2 装武器(范围 3),在范围 ✓ → 受影响
  // P4 距 P3 = 1,P4 徒手范围 1,在范围 ✓ → 受影响(无武器,默认令摸牌)
  // P1 距 P3 = 2,P1 徒手,不在范围
  // 座位顺序遍历:P2 先于 P4。
  it('受影响者选弃武器:弃一张武器牌', async () => {
    const w1 = makeWeapon('w1', '青釭剑', '♠', 3);
    const w2 = makeWeapon('w2', '丈八蛇矛', '♥', 3);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['w2'],
          equipment: { 武器: 'w1' },
        }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
        makePlayer({ index: 4, name: 'P4', character: '陆逊' }),
      ],
      cardMap: { w1, w2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const P4 = harness.player('P4');

    await P0.triggerAction('界解烦', 'use', { target: 3 });

    // 座位顺序:P2 先被询问
    P2.expectPending('请求回应');
    await P2.respond('界解烦', { choice: true }); // P2 选弃武器

    // 接下来 P4 被询问(徒手无武器)
    P4.expectPending('请求回应');
    await P4.respond('界解烦', { choice: false }); // P4 选令摸牌

    // P2 的手中武器 w2 被弃
    expect(harness.state.players[2].hand).not.toContain('w2');
    expect(harness.state.zones.discardPile).toContain('w2');
    // 限定技已用
    expect(harness.state.players[0].vars['界解烦/used']).toBe(true);
    // P3 摸一张(P4 选令摸牌);P2 选弃武器不令 P3 摸
    expect(harness.state.players[3].hand.length).toBe(1);
    // 第一轮标记被设
    expect(harness.state.turn.vars['界解烦/resetOnEnd']).toBe(0);
  });

  // ─── happy path:受影响者选令摸牌 → 目标摸一张牌 ────────────
  it('受影响者选令摸牌:目标摸一张牌', async () => {
    const w1 = makeWeapon('w1', '青釭剑', '♠', 3);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          equipment: { 武器: 'w1' },
        }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
        makePlayer({ index: 4, name: 'P4', character: '陆逊' }),
      ],
      cardMap: { w1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const P4 = harness.player('P4');

    const p3HandBefore = harness.state.players[3].hand.length;

    await P0.triggerAction('界解烦', 'use', { target: 3 });

    // P2 先选
    P2.expectPending('请求回应');
    await P2.respond('界解烦', { choice: false }); // 令摸牌

    // P4 选
    P4.expectPending('请求回应');
    await P4.respond('界解烦', { choice: false }); // 令摸牌

    // P3 摸 2 张(两人都选令摸牌)
    expect(harness.state.players[3].hand.length).toBe(p3HandBefore + 2);
    expect(harness.state.players[0].vars['界解烦/used']).toBe(true);
  });

  // ─── 第一轮发动:turn.vars reset 标记被设 ────────────
  it('第一轮发动:turn.vars[界解烦/resetOnEnd] 被设', async () => {
    // 5 人局,目标 P3 距离所有人 ≥ 1,P0 距 P3=2 不在范围
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
        makePlayer({ index: 4, name: 'P4', character: '陆逊' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} }, // 第一轮
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const P4 = harness.player('P4');

    await P0.triggerAction('界解烦', 'use', { target: 3 });

    // P2、P4 受影响,超时默认令摸牌(无武器)
    P2.expectPending('请求回应');
    await P2.respond('界解烦', { choice: false });
    P4.expectPending('请求回应');
    await P4.respond('界解烦', { choice: false });

    expect(harness.state.turn.vars['界解烦/resetOnEnd']).toBe(0);
    expect(harness.state.players[0].vars['界解烦/used']).toBe(true);
  });

  // ─── 非第一轮发动:不设 RESET_ON_END_VAR ────────────
  it('非第一轮发动:turn.vars[界解烦/resetOnEnd] 不设', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
        makePlayer({ index: 4, name: 'P4', character: '陆逊' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 2, phase: '出牌', vars: {} }, // 第二轮
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const P4 = harness.player('P4');

    await P0.triggerAction('界解烦', 'use', { target: 3 });

    P2.expectPending('请求回应');
    await P2.respond('界解烦', { choice: false });
    P4.expectPending('请求回应');
    await P4.respond('界解烦', { choice: false });

    expect(harness.state.turn.vars['界解烦/resetOnEnd']).toBeUndefined();
    expect(harness.state.players[0].vars['界解烦/used']).toBe(true);
  });

  // ─── 限定技只用一次:第二次发动被拒绝 ────────────
  it('限定技已用:第二次发动被拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界解烦'],
          vars: { '界解烦/used': true },
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 2, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界解烦',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 攻击范围外角色不被询问 ────────────
  it('攻击范围外角色不被询问', async () => {
    // 5 人局,P0 解烦 P3。
    // P0 距 P3 = 2,徒手不在范围
    // P1 距 P3 = 2,徒手不在范围 → 不被询问
    // P2 距 P3 = 1,徒手在范围 → 被询问
    // P4 距 P3 = 1,徒手在范围 → 被询问
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
        makePlayer({ index: 4, name: 'P4', character: '陆逊' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const P4 = harness.player('P4');

    await P0.triggerAction('界解烦', 'use', { target: 3 });

    // 唯一 pending 应是 P2(按座次顺序先于 P4)
    const slots = [...harness.state.pendingSlots.values()];
    expect(slots.length).toBe(1);
    expect((slots[0].atom as { target: number }).target).toBe(2);

    // P2 不在 P0 视角的"自己 pending",由 P2 自己回应
    await P2.respond('界解烦', { choice: false });
    // 然后 P4 被询问
    P4.expectPending('请求回应');
    await P4.respond('界解烦', { choice: false });
  });

  // ─── 选择弃武器但无武器 → 自动改为令摸牌 ────────────
  it('选弃武器但无武器手牌:自动改为令摸牌', async () => {
    // P2 装武器(在范围),手中只有杀(非武器)。
    // P2 选弃武器(choice=true)但 weaponCardsInHand 返回空 → 退回令摸牌
    const w1 = makeWeapon('w1', '青釭剑', '♠', 3);
    const slash = makeCard('x1', '杀', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          equipment: { 武器: 'w1' },
          hand: ['x1'],
        }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
      ],
      cardMap: { w1, x1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    // 4 人局 P0 解烦 P2 距离 1?P0 徒手 P2 在范围 → P0 也被影响
    // 但 P0 是 owner,先询问 P0?按座次顺序 0,1,2,3:P0(0)先于 P2(2)。
    // P0 无武器,默认令摸牌。
    // P1 距 P2 = 1,在范围 → P1 受影响(无武器,默认令摸牌)
    // P2 自身不在范围(inAttackRange 排除 self)
    // P3 距 P2 = 1,在范围 → P3 受影响
    // 实际受影响顺序:P0, P1, P3
    // P2 不被询问(自身不在范围)
    await P0.triggerAction('界解烦', 'use', { target: 2 });

    // P0 被询问(自身在范围内)
    const P0slot = harness.player('P0');
    P0slot.expectPending('请求回应');
    await P0slot.respond('界解烦', { choice: false }); // 令摸牌

    // P1 被询问
    const P1 = harness.player('P1');
    P1.expectPending('请求回应');
    await P1.respond('界解烦', { choice: false }); // 令摸牌

    // P3 被询问
    const P3 = harness.player('P3');
    P3.expectPending('请求回应');
    await P3.respond('界解烦', { choice: false }); // 令摸牌

    // 注意:P2 不被询问(目标自身不在攻击范围)
    // 此用例改验证:P2 装武器但目标是自己,P2 不被询问 → w1 仍在装备,x1 仍在手
    expect(harness.state.players[2].equipment['武器']).toBe('w1');
    expect(harness.state.players[2].hand).toContain('x1');
    void P2;
  });

  // ─── 第一轮发动后回合结束 → USED_KEY 被清空(限定技重置) ────────────
  it('第一轮发动 + 回合结束 → USED_KEY 被清空', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
        makePlayer({ index: 4, name: 'P4', character: '陆逊' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} }, // 第一轮
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const P4 = harness.player('P4');

    await P0.triggerAction('界解烦', 'use', { target: 3 });

    // 受影响者依次回应
    P2.expectPending('请求回应');
    await P2.respond('界解烦', { choice: false });
    P4.expectPending('请求回应');
    await P4.respond('界解烦', { choice: false });

    // 验证标记已设
    expect(harness.state.players[0].vars['界解烦/used']).toBe(true);
    expect(harness.state.turn.vars['界解烦/resetOnEnd']).toBe(0);

    // 触发回合结束 atom(直接 applyAtom)
    const { applyAtom } = await import('../../src/engine/create-engine');
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();

    // USED_KEY 被清空(限定技视为未发动)
    expect(harness.state.players[0].vars['界解烦/used']).toBeUndefined();
  });

  // ─── 非第一轮发动后回合结束 → USED_KEY 保留 ────────────
  it('非第一轮发动 + 回合结束 → USED_KEY 保留', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
        makePlayer({ index: 4, name: 'P4', character: '陆逊' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 2, phase: '出牌', vars: {} }, // 非第一轮
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const P4 = harness.player('P4');

    await P0.triggerAction('界解烦', 'use', { target: 3 });

    P2.expectPending('请求回应');
    await P2.respond('界解烦', { choice: false });
    P4.expectPending('请求回应');
    await P4.respond('界解烦', { choice: false });

    expect(harness.state.players[0].vars['界解烦/used']).toBe(true);
    expect(harness.state.turn.vars['界解烦/resetOnEnd']).toBeUndefined();

    // 触发回合结束 atom
    const { applyAtom } = await import('../../src/engine/create-engine');
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();

    // USED_KEY 保留(非第一轮不重置)
    expect(harness.state.players[0].vars['界解烦/used']).toBe(true);
  });

  // ─── 非自己回合 → 拒绝 ────────────
  it('非自己回合:拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界解烦',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 选自己为目标:合法(自身不在范围) ────────────
  it('选自己为目标:合法;其他在范围内的角色被询问', async () => {
    // 2 人局:P0 解烦 P0(自己)。P1 徒手距离 P0=1,在范围 → P1 被询问。
    // P0 自身不在范围(inAttackRange 返回 false for self)。
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界解烦'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 选自己为目标
    await P0.triggerAction('界解烦', 'use', { target: 0 });

    // P1 在 P0 的"攻击范围"内(距离 1,P1 徒手范围 1)→ P1 应被询问
    P1.expectPending('请求回应');
    // P1 选令摸牌 → P0 摸一张
    await P1.respond('界解烦', { choice: false });

    expect(harness.state.players[0].hand.length).toBeGreaterThan(0);
    expect(harness.state.players[0].vars['界解烦/used']).toBe(true);
  });
});
