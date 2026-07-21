// tests/skill-tests/界眩惑.test.ts
// 界眩惑(界法正·主动技)测试:
//   摸牌阶段结束时,你可以交给一名其他角色两张牌,令其选择一项:
//   1.对你指定的另一名角色使用一张【杀】;
//   2.你观看其手牌并获得其两张牌。
//
// 验证:
//   1. happy path 选项 1(出杀):法正发动 → 给 X 两张 → X 选出杀 → 法正指定 Y → X 出杀 → Y 受伤
//   2. happy path 选项 2(被获得):法正发动 → 给 X 两张 → X 选被获得 → 法正从 X 选 2 张获得
//   3. 不发动:法正 confirm=false → 无事发生,手牌不变
//   4. 触发条件不满足:手牌<2 → 不触发
//   5. 仅有一项可选:X 无杀 → 强制走选项 2
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { skillLoaders } from '../../src/engine/skills';
import * as 界眩惑Module from '../../src/engine/skills/界眩惑';
import type { SkillModule } from '../../src/engine/skill';
skillLoaders['界眩惑'] = async () => 界眩惑Module as unknown as SkillModule;

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
  character?: string;
  alive?: boolean;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界法正',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界眩惑'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

/** 触发 P0 的摸牌阶段结束:applyAtom(阶段结束, 0, 摸牌)
 *  关键:不能 await applyAtom——after-hook 会创建 pending 阻塞,需 void 启动后等稳定。
 *  同 界诛害.triggerEndPhase 模式。 */
async function triggerDrawPhaseEnd(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段结束', player, phase: '摸牌' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界眩惑', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path 选项 1:出杀 ─────────────────
  it('happy path 选项 1:法正发动 → 给 X 两张 → X 选出杀 → Y 受 1 伤', async () => {
    const c1 = makeCard('c1', '闪', '♠');
    const c2 = makeCard('c2', '闪', '♣');
    const xkill = makeCard('xkill', '杀', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], skills: ['界眩惑'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['xkill'],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          character: '刘备',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1, c2, xkill },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerDrawPhaseEnd(harness);

    // P0 被询问是否发动
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 选目标 X = P1
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 选 2 张手牌
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { cardIds: ['c1', 'c2'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 卡片已转给 P1
    expect(harness.state.players[1].hand).toContain('c1');
    expect(harness.state.players[1].hand).toContain('c2');
    expect(harness.state.players[0].hand).not.toContain('c1');

    // P1 选 选项 1(出杀)
    const P1 = harness.player('P1');
    P1.expectPending('请求回应');
    await P1.respond('界眩惑', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0(法正)指定 Y = P2
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { target: 2 });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 选一张杀
    P1.expectPending('请求回应');
    await P1.respond('界眩惑', { cardId: 'xkill' });
    await harness.waitForStable();
    harness.processAllEvents();

    // P2 被询问闪 → 不闪
    const P2 = harness.player('P2');
    await P2.pass();

    // P2 受 1 伤
    expect(harness.state.players[2].health).toBe(3);
    // P1 杀已用
    expect(harness.state.players[1].hand).not.toContain('xkill');
  });

  // ─── 2. happy path 选项 2:被获得 ─────────────────
  it('happy path 选项 2:法正发动 → 给 X 两张 → X 选被获得 → 法正从 X 取 2 张', async () => {
    const c1 = makeCard('c1', '闪', '♠');
    const c2 = makeCard('c2', '桃', '♣');
    const x1 = makeCard('x1', '桃', '♥');
    const x2 = makeCard('x2', '桃', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], skills: ['界眩惑'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['x1', 'x2'],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1, c2, x1, x2 },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerDrawPhaseEnd(harness);

    // 发动
    await P0.respond('界眩惑', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 选 X = P1
    await P0.respond('界眩惑', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 选 2 张手牌给 P1
    await P0.respond('界眩惑', { cardIds: ['c1', 'c2'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 接收后手牌: x1,x2,c1,c2(无杀 → 强制走选项 2)
    // P1 不被询问选择(因无杀) → 直接进入法正选牌阶段(P0 有 pending)

    // P0 从 P1 手牌选第 1 张(x1)
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { cardId: 'x1' });
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.players[0].hand).toContain('x1');

    // P0 从 P1 手牌选第 2 张(x2)
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { cardId: 'x2' });
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.players[0].hand).toContain('x2');

    // P1 现在手里只有 c1, c2(法正给的)
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(harness.state.players[1].hand).not.toContain('x1');
    expect(harness.state.players[1].hand).not.toContain('x2');
  });

  // ─── 3. 不发动 ─────────────────────────────────
  it('法正 confirm=false → 不发动,手牌不变,无询问', async () => {
    const c1 = makeCard('c1', '闪', '♠');
    const c2 = makeCard('c2', '杀', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], skills: ['界眩惑'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerDrawPhaseEnd(harness);

    // P0 选不发动
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无后续询问,手牌未变
    P0.expectNoPending();
    expect(harness.state.players[0].hand).toEqual(['c1', 'c2']);
  });

  // ─── 4. 手牌<2 → 不触发 ────────────────────────
  it('法正手牌<2 → 不触发(无询问)', async () => {
    const c1 = makeCard('c1', '闪', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['界眩惑'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerDrawPhaseEnd(harness);
    // 无询问(条件不满足)
    P0.expectNoPending();
  });

  // ─── 5. X 有杀 且 P0 强制 X 选被获得(cancel) ─────
  it('X 有杀 + 选 cancel → 法正从 X 取 2 张', async () => {
    const c1 = makeCard('c1', '桃', '♠');
    const c2 = makeCard('c2', '桃', '♣');
    const xkill = makeCard('xkill', '杀', '♦');
    const x1 = makeCard('x1', '桃', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], skills: ['界眩惑'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['xkill', 'x1'], // P1 有杀
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          character: '刘备',
        }),
      ],
      cardMap: { c1, c2, xkill, x1 },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerDrawPhaseEnd(harness);
    await P0.respond('界眩惑', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界眩惑', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界眩惑', { cardIds: ['c1', 'c2'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 接收 c1,c2 后手牌 4 张,有杀 → 被询问选 1/2
    const P1 = harness.player('P1');
    P1.expectPending('请求回应');
    // 但 P1 现在手牌 4 张 ≥2 可选 2;且有杀可选 1 → 两个选项都可
    // 选 cancel(选项 2 被获得)
    await P1.respond('界眩惑', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 选第 1 张
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { cardId: 'xkill' });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 选第 2 张
    P0.expectPending('请求回应');
    await P0.respond('界眩惑', { cardId: 'x1' });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].hand).toContain('xkill');
    expect(harness.state.players[0].hand).toContain('x1');
  });
});
