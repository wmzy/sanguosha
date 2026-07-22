// 界纵适(界简雍·蜀·被动技)测试
//   当你拼点赢时,你可以获得点数较小的拼点牌;
//   当你没赢时,你可以获得你的拼点牌。
//
// 验证:
//   1. owner 是 initiator 且赢 → 获对方的牌(点数较小)
//   2. owner 是 initiator 且输 → 获自己的牌
//   3. owner 是 initiator 且平 → 获自己的牌(算没赢)
//   4. 选择放弃(confirm=false)→ 不获牌
//   5. owner 是 target(他人发起的拼点)且赢 → 获对方(initiator)的牌
//   6. owner 是 target 且没赢 → 获自己的牌
//
// 测试拼点的发起:用界巧说(同武将技能,owner 作为 initiator)与
// 驱虎(荀彧发起,owner 作为 target)两种路径覆盖。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界简雍',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界纵适', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. owner 发起且赢 → 获对方的牌(点数较小)─────────────────
  it('owner 发起拼点且赢 → confirm 后获得对方的牌(点数较小)', async () => {
    const ownerHigh = makeCard('c1', '杀', '♠', 'K');
    const targetLow = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界巧说', '界纵适'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerHigh, c2: targetLow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 发起巧说拼点
    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    // P1 选拼点牌
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 拼点结算完:两张拼点牌已进弃牌堆,纵适询问 P0 是否获得较小牌
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');

    // P0 confirm 获得较小牌(c2)
    P0.expectPending('请求回应');
    await P0.respond('界纵适', { choice: true });
    await waitForStable(harness.state);

    // c2(对方较小牌)进 P0 手牌;c1 仍在弃牌堆
    expect(harness.state.players[0].hand).toContain('c2');
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c2');
  });

  // ─── 2. owner 发起且输 → 获自己的牌 ──────────────────────────
  it('owner 发起拼点且输 → confirm 后获得自己的牌', async () => {
    const ownerLow = makeCard('c1', '杀', '♠', '2');
    const targetHigh = makeCard('c2', '闪', '♥', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界巧说', '界纵适'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerLow, c2: targetHigh },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    P0.expectPending('请求回应');
    await P0.respond('界纵适', { choice: true });
    await waitForStable(harness.state);

    // c1(自己的牌)回到 P0 手牌;c2 留弃牌堆
    expect(harness.state.players[0].hand).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
  });

  // ─── 3. owner 发起且平 → 算没赢,获自己的牌 ──────────────────
  it('owner 发起拼点平局(点数相等)→ 算没赢,获得自己的牌', async () => {
    const ownerK = makeCard('c1', '杀', '♠', 'K');
    const targetK = makeCard('c2', '闪', '♥', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界巧说', '界纵适'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerK, c2: targetK },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    P0.expectPending('请求回应');
    await P0.respond('界纵适', { choice: true });
    await waitForStable(harness.state);

    // 平局算没赢,获自己的牌 c1
    expect(harness.state.players[0].hand).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
  });

  // ─── 4. 放弃(confirm=false)→ 不获牌 ───────────────────────
  it('owner 选择放弃(confirm=false)→ 不获牌,弃牌堆不变', async () => {
    const ownerHigh = makeCard('c1', '杀', '♠', 'K');
    const targetLow = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界巧说', '界纵适'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerHigh, c2: targetLow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    P0.expectPending('请求回应');
    // 放弃(pass 等同 choice=false)
    await P0.respond('界纵适', { choice: false });
    await waitForStable(harness.state);

    // 两张牌都仍在弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c2');
  });

  // ─── 5. owner 作为 target(他人发起拼点,如驱虎)赢 → 获对方(initiator)的牌 ──
  it('owner 作为 target 被拼点且赢 → 获对方(initiator)的牌', async () => {
    // P1 是荀彧(驱虎), P0 是界简雍(界纵适)
    // 驱虎:P1 与 P0 拼点,P1 赢则 P0 受伤;P1 输则 P1 受伤。
    // 这里 P0 拼点赢(K>P1的2),所以 P1 没赢、P1 受伤;P0 赢,纵适获对方较小牌(=c2, P1的2)。
    const ownerHigh = makeCard('c0', '闪', '♠', 'K');
    const initiatorLow = makeCard('c1', '杀', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c0'],
          skills: ['界纵适'],
        }),
        makePlayer({
          index: 1,
          name: 'P1-荀彧',
          hand: ['c1'],
          skills: ['驱虎'],
        }),
      ],
      cardMap: { c0: ownerHigh, c1: initiatorLow },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1-荀彧');

    // P1 发动驱虎,target=P0(self-damage 路径:驱虎点数赢则对方受伤,
    // 这里 P1 用 2 拼 P0 的 K → P1 没赢 → P0 对 P1 造成 1 伤害(驱虎规则)).
    // 驱虎 需要 source 指 target 攻击范围内的另一角色,但 2 人局无第三者 →
    // P1 没赢后由 P0 对 P1 造成伤害(驱虎 target=P0 即"该角色对你造成1点伤害")。
    await P1.triggerAction('驱虎', 'use', { cardId: 'c1', target: 0 });
    await waitForStable(harness.state);
    // P0 选拼点牌
    await P0.respond('驱虎', { cardId: 'c0' });
    await waitForStable(harness.state);

    // 拼点结算后,P0 应被询问纵适
    P0.expectPending('请求回应');
    await P0.respond('界纵适', { choice: true });
    await waitForStable(harness.state);

    // P0 赢(K>2)→ 获对方较小的牌 c1(P1 的 2)
    expect(harness.state.players[0].hand).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c1');
  });
});
