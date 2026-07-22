// 界明策(界陈宫·群·主动技)行为测试:
//   OL 界限突破官方逐字:
//   "出牌阶段限一次,你可以交给一名其他角色一张【杀】或装备牌,然后其选择一项:
//    1.视为对你选择的另一名角色使用一张【杀】,若造成伤害,执行另一项;
//    2.你与其各摸一张牌。"
//
// 与标版差异(标版陈宫·未实现):
//   - 选项 1 取消"其攻击范围内"距离限制;命中后追加执行选项 2
//   - 选项 2 改为"你与其各摸一张"(标版仅 target 摸一张)
//
// 验证场景:
//   ① 给杀 + 选项①(出杀) + 命中 → killTarget 受伤 + owner/target 各摸 1
//   ② 给杀 + 选项①(出杀) + 未命中(target 出闪)→ killTarget 不受伤 + 不摸牌
//   ③ 给杀 + 选项②(摸牌)→ owner 与 target 各摸 1,killTarget 不受伤
//   ④ 给装备(手牌中) + 选项①命中 → 装备移到 target + 出杀
//   ⑤ 限一次:第二次发动被拒绝
//   ⑥ validate:非自己回合 → 拒绝;非出牌阶段 → 拒绝
//   ⑦ validate:给牌目标 = 自己 → 拒绝;killTarget = target → 拒绝
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
  const c: Card = { id, name, suit, color: suitColor(suit), rank, type };
  if (subtype) c.subtype = subtype;
  if (type === '装备牌' && subtype === '武器') c.range = 2;
  return c;
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
    character: opts.character ?? '界陈宫',
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
  };
}

describe('界明策', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── ① 给杀 + 选项① + 命中 → killTarget 受伤 + 双方各摸 1 ─────

  it('①:给杀 + target 选①出杀 + 命中 → killTarget 受伤,owner/target 各摸 1', async () => {
    const give = makeCard('g1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // P0 = 界陈宫(明策 owner)
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['g1'],
          skills: ['界明策'],
          health: 3,
          maxHealth: 3,
        }),
        // P1 = 被给牌者(target),会被询问选项
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        // P2 = 杀目标(killTarget)
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { g1: give },
      currentPlayerIndex: 0, // P0 自己回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    // P0 发动明策:给 P1 一张杀,杀目标=P2
    await harness.player('P0').triggerAction('界明策', 'use', {
      cardId: 'g1',
      targets: [1, 2],
    });
    await harness.waitForStable();

    // 询问 P1 选项:confirm=true → 选项①出杀
    harness.player('P1').expectPending('请求回应');
    await harness.player('P1').respond('界明策', { choice: true });
    await harness.waitForStable();

    // P2 被询问出闪:pass(不出闪)
    harness.player('P2').expectPending('询问闪');
    await harness.player('P2').pass();
    await harness.waitForStable();

    // 断言:
    // 1) g1 移到 P1 手牌
    expect(harness.state.players[1].hand).toContain('g1');
    expect(harness.state.players[0].hand).not.toContain('g1');
    // 2) P2 受 1 点伤害(被虚拟杀命中)
    expect(harness.state.players[2].health).toBe(3);
    // 3) 命中后执行另一项:owner 与 P1 各摸 1
    //    owner 原本 hand=[] (g1 已给出去),摸 1 → hand=1
    //    P1 hand = [g1],摸 1 → hand=2
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore - 1 + 1); // -g1 +draw
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore + 1 + 1); // +g1 +draw
    // 4) 限一次标记已写
    expect(harness.state.players[0].vars['界明策/usedThisTurn']).toBe(true);
  });

  // ─── ② 给杀 + 选项① + 未命中 → killTarget 不受伤,不摸牌 ─────

  it('②:给杀 + target 选①出杀 + 未命中(出闪)→ killTarget 不受伤,不摸牌', async () => {
    const give = makeCard('g2', '杀', '♠', '8');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['g2'],
          skills: ['界明策'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [dodge.id],
          skills: ['闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { g2: give, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').triggerAction('界明策', 'use', {
      cardId: 'g2',
      targets: [1, 2],
    });
    await harness.waitForStable();

    // P1 选①
    await harness.player('P1').respond('界明策', { choice: true });
    await harness.waitForStable();

    // P2 出闪(闪只有 respond action)
    harness.player('P2').expectPending('询问闪');
    await harness.player('P2').respond('闪', { cardId: 'd1' });
    await harness.waitForStable();

    // 断言:
    // 1) g2 给到 P1
    expect(harness.state.players[1].hand).toContain('g2');
    // 2) P2 未受伤(出闪抵消)
    expect(harness.state.players[2].health).toBe(4);
    // 3) 未命中 → 不执行另一项,不摸牌
    //    P0 hand = [] (-g2 给出,未摸), P1 hand = [g2] (+g2 收到,未摸)
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[1].hand).toEqual(['g2']);
    // 4) 闪入弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  // ─── ③ 给杀 + 选项②(摸牌)→ owner 与 target 各摸 1 ───────

  it('③:给杀 + target 选②摸牌 → owner/target 各摸 1,killTarget 不受伤', async () => {
    const give = makeCard('g3', '杀', '♠', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['g3'],
          skills: ['界明策'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { g3: give },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').triggerAction('界明策', 'use', {
      cardId: 'g3',
      targets: [1, 2],
    });
    await harness.waitForStable();

    // P1 选②:cancel/choice=false
    await harness.player('P1').respond('界明策', { choice: false });
    await harness.waitForStable();

    // 断言:
    // 1) g3 给到 P1
    expect(harness.state.players[1].hand).toContain('g3');
    // 2) P2 未受伤(未出杀)
    expect(harness.state.players[2].health).toBe(4);
    // 3) owner 与 P1 各摸 1
    //    P0 hand=[] (-g3 给出),摸 1 → hand=1
    //    P1 hand=[g3] (+g3 收到),摸 1 → hand=2
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.players[1].hand.length).toBe(2);
    // g3 仍在 P1 手牌(摸的牌是牌堆顶的测试牌,g3 也在)
    expect(harness.state.players[1].hand).toContain('g3');
  });

  // ─── ④ 给装备(手牌) + 选项①命中 ──────────────────────────

  it('④:给手牌中的装备 + target 选①出杀 + 命中 → 装备到 target + 出杀 + 各摸 1', async () => {
    const weapon = makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌', '武器');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1'],
          skills: ['界明策'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
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

    await harness.player('P0').triggerAction('界明策', 'use', {
      cardId: 'w1',
      targets: [1, 2],
    });
    await harness.waitForStable();

    // P1 选①
    await harness.player('P1').respond('界明策', { choice: true });
    await harness.waitForStable();
    // P2 不出闪
    await harness.player('P2').pass();
    await harness.waitForStable();

    // 断言:
    // 1) w1(装备)给到 P1 手牌
    expect(harness.state.players[1].hand).toContain('w1');
    // 2) P2 受 1 点伤害
    expect(harness.state.players[2].health).toBe(3);
    // 3) 命中 → 双方各摸 1
    expect(harness.state.players[0].hand.length).toBe(1); // -w1 +draw = 1
    expect(harness.state.players[1].hand.length).toBe(2); // +w1 +draw = 2
  });

  // ─── ⑤ 限一次:第二次被拒绝 ────────────────────────────────

  it('⑤:限一次——第二次发动被拒绝', async () => {
    const give1 = makeCard('g5a', '杀', '♠', '7');
    const give2 = makeCard('g5b', '杀', '♠', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['g5a', 'g5b'],
          skills: ['界明策'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { g5a: give1, g5b: give2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 第一次发动
    await harness.player('P0').triggerAction('界明策', 'use', {
      cardId: 'g5a',
      targets: [1, 2],
    });
    await harness.waitForStable();
    await harness.player('P1').respond('界明策', { choice: false }); // 选②摸牌
    await harness.waitForStable();
    expect(harness.state.players[0].vars['界明策/usedThisTurn']).toBe(true);

    // 第二次:应当被 validate 拒绝
    await harness.player('P0').expectRejected({
      skillId: '界明策',
      actionType: 'use',
      params: { cardId: 'g5b', targets: [1, 2] },
    });
    // 第二张杀仍在 P0 手中
    expect(harness.state.players[0].hand).toContain('g5b');
  });

  // ─── ⑥ validate:非自己回合 → 拒绝 ──────────────────────────

  it('⑥:非自己回合发动 → validate 拒绝', async () => {
    const give = makeCard('g6', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['g6'],
          skills: ['界明策'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { g6: give },
      currentPlayerIndex: 1, // P1 回合,不是 P0
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').expectRejected({
      skillId: '界明策',
      actionType: 'use',
      params: { cardId: 'g6', targets: [1, 2] },
    });
    expect(harness.state.players[0].hand).toContain('g6');
  });

  // ─── ⑦ validate:给牌目标 = 自己 → 拒绝;killTarget = target → 拒绝 ──

  it('⑦a:给牌目标=自己 → validate 拒绝', async () => {
    const give = makeCard('g7a', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['g7a'],
          skills: ['界明策'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { g7a: give },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').expectRejected({
      skillId: '界明策',
      actionType: 'use',
      params: { cardId: 'g7a', targets: [0, 1] }, // target=P0 自己
    });
    expect(harness.state.players[0].hand).toContain('g7a');
  });

  it('⑦b:killTarget=给牌 target → validate 拒绝(必须是"另一名角色")', async () => {
    const give = makeCard('g7b', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['g7b'],
          skills: ['界明策'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { g7b: give },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // killTarget = target(P1) → 拒绝
    await harness.player('P0').expectRejected({
      skillId: '界明策',
      actionType: 'use',
      params: { cardId: 'g7b', targets: [1, 1] },
    });
    expect(harness.state.players[0].hand).toContain('g7b');
  });
});
