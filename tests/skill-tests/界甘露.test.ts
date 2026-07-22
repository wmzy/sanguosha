// tests/skill-tests/界甘露.test.ts
// 界甘露(界吴国太·主动技)测试:
//   出牌阶段限一次,令两名角色交换装备区里的牌;
//   若两人装备数差 X > 你已损失的体力值,你须弃 X 张牌。
//
// 验证:
//   1. 正面:两人装备数差=0(均1张),吴国太满血 → 直接交换,不弃牌
//   2. 装备数差=2,吴国太已损失1 → X(2) > lostHp(1) → 弃2张牌后交换
//   3. 装备数差=2,吴国太已损失0 → X(2) > lostHp(0) → 弃2张牌后交换
//   4. 装备数差=2,吴国太已损失2 → X(2) <= lostHp(2) → 直接交换,不弃牌
//   5. 不同 slot 交换:A 有武器,B 有防具 → A 得防具,B 得武器
//   6. 同 slot 交换:双方都武器 → 武器互换
//   7. 限一次:本回合已用过 → 拒绝
//   8. 非出牌阶段 / 非自己回合 → 拒绝
//   9. X > lostHp 但手牌不足 → 流程中止,不交换
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
  subtype?: string,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, subtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界吴国太',
    health: opts.health ?? 3,
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
    faction: '吴',
    identity: '主公',
  };
}

describe('界甘露', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 装备数差=0,满血 → 直接交换,不弃牌 ───────────────────

  it('P1(武器) vs P2(防具),X=0:直接交换,A 得防具 B 得武器', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '吴国太',
          hand: ['c1', 'c2'],
          skills: ['界甘露', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          equipment: { 武器: 'w1' },
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          equipment: { 防具: 'a1' },
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        a1: makeCard('a1', '仁王盾', '♠', '2', '装备牌', '防具'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('吴国太');

    // 发动界甘露
    await P0.triggerAction('界甘露', 'use');
    P0.expectPending('请求回应'); // 选目标
    await P0.respond('界甘露', { targets: [1, 2] });

    // X=0,无弃牌询问,直接交换
    // P1 原武器 → P2;P2 原防具 → P1
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].equipment['防具']).toBe('a1');
    expect(harness.state.players[2].equipment['防具']).toBeUndefined();
    expect(harness.state.players[2].equipment['武器']).toBe('w1');
    // 吴国太手牌未弃
    expect(harness.state.players[0].hand.length).toBe(2);
    // 限一次标记已设
    expect(harness.state.players[0].vars['界甘露/usedThisTurn']).toBe(true);
  });

  // ─── 2. X > lostHp → 弃 X 张后交换 ───────────────────────────

  it('P1(2装备) vs P2(0装备),X=2 > lostHp=0 → 弃2张后交换', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '吴国太',
          hand: ['c1', 'c2', 'c3'],
          skills: ['界甘露', '回合管理'],
          health: 3,
          maxHealth: 3, // lostHp=0
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          equipment: { 武器: 'w1', 防具: 'a1' },
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        c3: makeCard('c3', '桃'),
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        a1: makeCard('a1', '仁王盾', '♠', '2', '装备牌', '防具'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('吴国太');

    await P0.triggerAction('界甘露', 'use');
    P0.expectPending('请求回应'); // 选目标
    await P0.respond('界甘露', { targets: [1, 2] });

    // X=2 > lostHp=0 → 弃2张
    P0.expectPending('请求回应');
    const slot = [...harness.state.pendingSlots.values()][0];
    const atom = slot.atom as { requestType?: string };
    expect(atom.requestType).toBe('界甘露/discard');
    await P0.respond('界甘露', { cardIds: ['c1', 'c2'] });

    // 交换:P1 的 2 装备 → P2;P2 无装备 → P1 无装备
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
    expect(harness.state.players[2].equipment['武器']).toBe('w1');
    expect(harness.state.players[2].equipment['防具']).toBe('a1');
    // 吴国太弃了 c1,c2
    expect(harness.state.players[0].hand).toEqual(['c3']);
    expect(harness.state.zones.discardPile).toEqual(
      expect.arrayContaining(['c1', 'c2']),
    );
  });

  // ─── 3. X <= lostHp → 直接交换,不弃牌 ──────────────────────

  it('X=2, lostHp=2 → 直接交换,不弃牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '吴国太',
          hand: ['c1', 'c2'],
          skills: ['界甘露', '回合管理'],
          health: 1,
          maxHealth: 3, // lostHp=2
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          equipment: { 武器: 'w1', 防具: 'a1' },
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        a1: makeCard('a1', '仁王盾', '♠', '2', '装备牌', '防具'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('吴国太');

    await P0.triggerAction('界甘露', 'use');
    P0.expectPending('请求回应');
    await P0.respond('界甘露', { targets: [1, 2] });

    // X=2, lostHp=2 → 不弃牌,直接交换
    expect(harness.state.players[0].hand.length).toBe(2); // 未弃
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[2].equipment['武器']).toBe('w1');
    expect(harness.state.players[2].equipment['防具']).toBe('a1');
  });

  // ─── 4. 同 slot 交换:双方都武器 ───────────────────────────

  it('双方武器互换', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '吴国太',
          hand: [],
          skills: ['界甘露', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          equipment: { 武器: 'w1' },
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          equipment: { 武器: 'w2' },
          skills: [],
        }),
      ],
      cardMap: {
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        w2: makeCard('w2', '青釭剑', '♠', '6', '装备牌', '武器'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('吴国太');

    await P0.triggerAction('界甘露', 'use');
    P0.expectPending('请求回应');
    await P0.respond('界甘露', { targets: [1, 2] });

    // 武器互换:P1 得 w2,P2 得 w1
    expect(harness.state.players[1].equipment['武器']).toBe('w2');
    expect(harness.state.players[2].equipment['武器']).toBe('w1');
  });

  // ─── 5. 限一次:本回合已用过 → 拒绝 ─────────────────────────

  it('本回合已用过 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '吴国太',
          hand: [],
          skills: ['界甘露', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          equipment: { 武器: 'w1' },
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          equipment: { 防具: 'a1' },
          skills: [],
        }),
      ],
      cardMap: {
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        a1: makeCard('a1', '仁王盾', '♠', '2', '装备牌', '防具'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('吴国太');

    // 第一次发动:成功
    await P0.triggerAction('界甘露', 'use');
    P0.expectPending('请求回应');
    await P0.respond('界甘露', { targets: [1, 2] });
    expect(harness.state.players[1].equipment['防具']).toBe('a1');

    // 第二次发动:拒绝
    await P0.expectRejected({
      skillId: '界甘露',
      actionType: 'use',
      params: {},
    });
  });

  // ─── 6. 非自己回合 / 非出牌阶段 → 拒绝 ─────────────────────

  it('非自己回合 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '吴国太',
          hand: [],
          skills: ['界甘露', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          equipment: { 武器: 'w1' },
          skills: ['杀'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          equipment: { 防具: 'a1' },
          skills: [],
        }),
      ],
      cardMap: {
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        a1: makeCard('a1', '仁王盾', '♠', '2', '装备牌', '防具'),
      },
      currentPlayerIndex: 1, // P1 的回合,不是吴国太
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('吴国太');

    await P0.expectRejected({
      skillId: '界甘露',
      actionType: 'use',
      params: {},
    });
  });

  // ─── 7. X > lostHp 但手牌不足 → 流程中止 ───────────────────

  it('X=2 但吴国太仅 1 手牌 → 中止,不交换不弃牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '吴国太',
          hand: ['c1'], // 仅 1 张手牌
          skills: ['界甘露', '回合管理'],
          health: 3,
          maxHealth: 3, // lostHp=0
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          equipment: { 武器: 'w1', 防具: 'a1' }, // 2 装备
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          skills: [], // 0 装备 → X=2
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        a1: makeCard('a1', '仁王盾', '♠', '2', '装备牌', '防具'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('吴国太');

    await P0.triggerAction('界甘露', 'use');
    P0.expectPending('请求回应');
    await P0.respond('界甘露', { targets: [1, 2] });

    // X=2 > lostHp=0,但仅 1 张手牌 → 不弹弃牌询问,流程中止
    // (限一次标记已设,但无副作用)
    expect(harness.state.players[1].equipment['武器']).toBe('w1'); // 未交换
    expect(harness.state.players[1].equipment['防具']).toBe('a1');
    expect(harness.state.players[2].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['c1']); // 未弃
  });

  // ─── 8. respond 校验 ────────────────────────────────────

  it('respond:targets 长度 != 2 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '吴国太',
          hand: [],
          skills: ['界甘露', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          equipment: { 武器: 'w1' },
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          equipment: { 防具: 'a1' },
          skills: [],
        }),
      ],
      cardMap: {
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        a1: makeCard('a1', '仁王盾', '♠', '2', '装备牌', '防具'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('吴国太');

    await P0.triggerAction('界甘露', 'use');
    P0.expectPending('请求回应');

    // 仅选 1 名目标 → 拒绝
    await P0.expectRejected({
      skillId: '界甘露',
      actionType: 'respond',
      params: { targets: [1] },
    });
    // 选同一名 → 拒绝
    await P0.expectRejected({
      skillId: '界甘露',
      actionType: 'respond',
      params: { targets: [1, 1] },
    });
  });
});
