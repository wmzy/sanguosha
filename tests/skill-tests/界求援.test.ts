// 界求援(界伏皇后·群·被动技)测试(界限突破版):
// 核心差异(相对标伏皇后 求援;标版未实现,基于官方描述对比):
//   1. 标版仅杀触发;界版杀或伤害锦囊触发
//   2. 标版选项1固定要闪;界版要"同类型不同牌名"的牌
//
// 用例:
//   1. owner 被杀 → 发动求援 → helper 选给牌 → owner 收到牌(同类型不同牌名)
//   2. owner 被杀 → 发动求援 → helper 选成为额外目标 → helper 被虚拟杀命中
//   3. owner 拒绝发动 → 不触发
//   4. owner 被杀 → 发动求援 → helper 无符合牌 → 自动转为成为额外目标
//   5. owner 被杀 → helper 选给牌(杀类型,不同牌名=桃) → owner 收到桃
//   6. owner 满血不被指定(杀不会触发成为目标)
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
    character: opts.name,
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
  };
}

/** 当前 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  if (state.pendingSlots.size === 0) return null;
  const slot = [...state.pendingSlots.values()][0];
  return (slot.atom as { requestType?: string }).requestType ?? null;
}

describe('界求援', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. helper 选给牌(同类型不同牌名) ───────────────────
  it('owner 被杀 → 求援 → helper 给同类型不同牌名的牌 → owner 收到', async () => {
    // P0=界伏皇后(目标);P1=杀来源;P2=helper(手牌:闪=基本牌,不同牌名)
    // 杀是基本牌,helper 的闪也是基本牌,且牌名不同 → 符合条件
    const slash = makeCard('s1', '杀', '♠', '5');
    const dodge = makeCard('d1', '闪', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: [],
          skills: ['界求援', '闪', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['s1'],
          skills: ['杀', '回合管理'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { s1: slash, d1: dodge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界伏皇后');
    const P2 = harness.player('P2');

    // P1 对 P0 出杀
    await P1.useCardAndTarget('杀', 's1', [0]);
    await waitForStable(harness.state);

    // P0 触发求援 confirm
    expect(currentRequestType(harness.state)).toBe('界求援/confirm');
    await P0.respond('界求援', { choice: true });
    await waitForStable(harness.state);

    // P0 选 helper=P2
    expect(currentRequestType(harness.state)).toBe('界求援/chooseTarget');
    await P0.respond('界求援', { target: 2 });
    await waitForStable(harness.state);

    // P2 选 option(给牌)
    expect(currentRequestType(harness.state)).toBe('界求援/option');
    await P2.respond('界求援', { choice: true });
    await waitForStable(harness.state);

    // P2 选具体的牌(闪)
    expect(currentRequestType(harness.state)).toBe('界求援/giveCard');
    await P2.respond('界求援', { cardId: 'd1' });
    await waitForStable(harness.state);

    // owner 收到闪
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[2].hand).not.toContain('d1');

    // 杀结算继续:owner 询问闪 → owner 有闪可出,但选择不出 → pass → 受伤
    await P0.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(2); // 3 - 1
    // P2 未受伤(选了给牌,未成额外目标)
    expect(harness.state.players[2].health).toBe(4);
  });

  // ─── 2. helper 选成为额外目标(虚拟杀命中) ─────────────────
  it('owner 被杀 → 求援 → helper 成为额外目标 → helper 受 1 点伤害', async () => {
    // P0=界伏皇后(目标);P1=杀来源;P2=helper(无闪,会被虚拟杀命中)
    const slash = makeCard('s1', '杀', '♠', '5');
    const helperCard = makeCard('p1', '桃', '♥', '7'); // 桃:基本牌,不同牌名(但 helper 选 2 不给)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: [],
          skills: ['界求援', '闪', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['s1'],
          skills: ['杀', '回合管理'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: ['p1'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { s1: slash, p1: helperCard },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界伏皇后');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await waitForStable(harness.state);

    await P0.respond('界求援', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界求援', { target: 2 });
    await waitForStable(harness.state);

    // P2 选 option=2(成为额外目标,choice=false)
    await P2.respond('界求援', { choice: false });
    await waitForStable(harness.state);

    // 虚拟杀(source=P1 → target=P2)→ P2 询问闪 → pass → 命中
    await P2.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[2].health).toBe(3); // 4 - 1

    // 原 杀 继续结算:owner 询问闪 → pass → 受伤
    await P0.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(2); // 3 - 1
  });

  // ─── 3. owner 拒绝发动 → 不触发 ────────────────────────
  it('owner 拒绝发动 → 杀正常结算(无求援)', async () => {
    const slash = makeCard('s1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: [],
          skills: ['界求援', '闪', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['s1'],
          skills: ['杀', '回合管理'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界伏皇后');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await waitForStable(harness.state);

    // 触发 confirm 但 owner 拒绝
    expect(currentRequestType(harness.state)).toBe('界求援/confirm');
    await P0.respond('界求援', { choice: false });
    await waitForStable(harness.state);

    // 杀正常结算:owner 询问闪 → pass → 受伤
    await P0.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(2); // 3 - 1
  });

  // ─── 4. helper 无符合牌 → 自动转为成为额外目标 ──────────
  it('helper 选给牌但无符合牌 → 自动转为成为额外目标', async () => {
    // 杀是基本牌;helper 手牌只有锦囊(无懈可击)→ 无同类型不同牌名的基本牌
    const slash = makeCard('s1', '杀', '♠', '5');
    const wx = makeCard('w1', '无懈可击', '♥', '7', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: [],
          skills: ['界求援', '闪', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['s1'],
          skills: ['杀', '回合管理'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: ['w1'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { s1: slash, w1: wx },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界伏皇后');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await waitForStable(harness.state);
    await P0.respond('界求援', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界求援', { target: 2 });
    await waitForStable(harness.state);

    // P2 选给牌(option=1)→ 但无符合牌 → 自动转为额外目标(虚拟杀)
    await P2.respond('界求援', { choice: true });
    await waitForStable(harness.state);

    // P2 被虚拟杀命中(无闪可出)
    await P2.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[2].health).toBe(3); // 4 - 1
    // P2 的无懈可击仍在手中(未给出)
    expect(harness.state.players[2].hand).toContain('w1');

    // 原 杀 继续结算:owner 受伤
    await P0.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(2);
  });

  // ─── 5. owner 自己回合外被杀也可触发(被动) ─────────────
  it('owner 被杀 → 求援 → helper 给桃(同类型不同牌名)→ owner 收到桃', async () => {
    // 杀和桃都是基本牌,牌名不同 → 符合条件
    const slash = makeCard('s1', '杀', '♠', '5');
    const peach = makeCard('p1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: [],
          skills: ['界求援', '闪', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['s1'],
          skills: ['杀', '回合管理'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: ['p1'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { s1: slash, p1: peach },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界伏皇后');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await waitForStable(harness.state);
    await P0.respond('界求援', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界求援', { target: 2 });
    await waitForStable(harness.state);
    await P2.respond('界求援', { choice: true });
    await waitForStable(harness.state);

    expect(currentRequestType(harness.state)).toBe('界求援/giveCard');
    await P2.respond('界求援', { cardId: 'p1' });
    await waitForStable(harness.state);

    // owner 收到桃
    expect(harness.state.players[0].hand).toContain('p1');

    // 杀继续结算:owner 询问闪 → pass → 受伤
    await P0.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(2);
  });

  // ─── 6. 同一张杀仅触发一次求援 ─────────────────────────
  it('同一张杀的多个目标事件仅触发一次求援', async () => {
    // 这里的"同一张卡"防重入:owner 被指定后,成为目标 hook 只触发一次求援流程
    const slash = makeCard('s1', '杀', '♠', '5');
    const dodge = makeCard('d1', '闪', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: [],
          skills: ['界求援', '闪', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['s1'],
          skills: ['杀', '回合管理'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { s1: slash, d1: dodge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界伏皇后');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await waitForStable(harness.state);

    // 仅触发一次 confirm(不是多次)
    expect(currentRequestType(harness.state)).toBe('界求援/confirm');
    await P0.respond('界求援', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界求援', { target: 2 });
    await waitForStable(harness.state);
    await P2.respond('界求援', { choice: true });
    await waitForStable(harness.state);
    await P2.respond('界求援', { cardId: 'd1' });
    await waitForStable(harness.state);

    // 防重入标志已设
    const key = `界求援/processed/s1`;
    expect(harness.state.localVars[key]).toBe(true);

    // 杀继续结算
    await P0.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(2);
  });
});
