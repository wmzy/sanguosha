// tests/skill-tests/洛神.test.ts
// 洛神(甄姬·被动技)测试:准备阶段判定循环,黑色获得判定牌并重复。
//
// 验证:
//   1. 正面:deck=[黑桃, 红桃] → 发动洛神 → 第一张黑桃获得 → 继续 → 第二张红桃停止
//   2. 正面:deck=[黑桃, 黑桃, 红桃] → 两次黑桃获得 → 红桃停止(共获 2 张)
//   3. 负面:不发动(confirm=false) → 不判定,不获得牌
//   4. 边界:deck 顶为红色 → 发动后立即停止(获得 0 张)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '甄姬',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['洛神'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发准备阶段:applyAtom(阶段开始, 0, 准备) → 洛神 after-hook 启动循环
 *  注意:阶段开始 的 after-hook(洛神)会创建 pending 并 await,导致 applyAtom 阻塞。
 *  用 void fire-and-forget,再 waitForStable 等 pending 创建。 */
async function triggerPreparePhase(harness: SkillTestHarness): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('洛神', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('正面:[♠, ♥] → 发动 → 获得黑桃 → 继续 → 红桃停止(获 1 张)', async () => {
    const j1 = makeCard('j1', '杀', '♠', '5'); // 黑桃(黑)→ 获得
    const j2 = makeCard('j2', '桃', '♥', '3'); // 红桃(红)→ 停止
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['洛神'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { j1, j2 },
      zones: { deck: ['j1', 'j2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 触发准备阶段 → 洛神询问是否发动
    await triggerPreparePhase(harness);
    P1.expectPending('请求回应');

    // P1 确认发动
    await P1.respond('洛神', { choice: true });
    // 第一张判定(黑桃)→ 询问继续
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应');

    // P1 确认继续 → 第二张判定(红桃)→ 自动停止
    await P1.respond('洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 应获得 1 张(黑桃 j1);红桃 j2 进弃牌堆
    expect(harness.state.players[0].hand).toContain('j1');
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.zones.discardPile).toContain('j2');
  });

  it('正面:[♠, ♣, ♥] → 两次黑桃获得 → 红桃停止(获 2 张)', async () => {
    const j1 = makeCard('j1', '杀', '♠', '5');
    const j2 = makeCard('j2', '杀', '♣', '7');
    const j3 = makeCard('j3', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['洛神'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { j1, j2, j3 },
      zones: { deck: ['j1', 'j2', 'j3'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    // 发动
    await P1.respond('洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // 第一次判定(♠黑)→ 继续?
    P1.expectPending('请求回应');
    await P1.respond('洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // 第二次判定(♣黑)→ 继续?
    P1.expectPending('请求回应');
    await P1.respond('洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // 第三次判定(♥红)→ 自动停止

    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toContain('j1');
    expect(harness.state.players[0].hand).toContain('j2');
    expect(harness.state.zones.discardPile).toContain('j3');
  });

  it('负面:不发动(confirm=false) → 不判定,不获得牌', async () => {
    const j1 = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['洛神'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { j1 },
      zones: { deck: ['j1'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    P1.expectPending('请求回应');

    // P1 不发动
    await P1.respond('洛神', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 未判定,手牌仍为 0,牌堆不变
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(1);
  });

  it('边界:deck 顶为红色 → 发动后立即停止(获得 0 张)', async () => {
    const j1 = makeCard('j1', '桃', '♥', '3'); // 红桃(红)→ 停止
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['洛神'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { j1 },
      zones: { deck: ['j1'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 红色判定 → 不获得,不询问继续
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('j1');
  });
});
