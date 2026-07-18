// tests/skill-tests/界洛神.test.ts
// 界洛神(界甄姬·被动技):准备阶段判定,黑色获得判定牌并重复;
//   以此法获得的牌本回合不计入手牌上限。
//
// 官方(逐字):"准备阶段,你可以判定,若结果为黑色,你获得此牌,
//   然后你可以重复此流程。以此法获得的牌本回合不计入手牌上限。"
//
// 验证:
//   1. 正面:[♠, ♥] → 发动 → 获黑桃 → 继续 → 红桃停止且不获得(获 1 张)
//   2. 正面:[♠, ♣, ♥] → 两次黑桃获得 → 红桃停止不获得(获 2 张)
//   3. 负面:不发动 → 不判定,不获得牌
//   4. 边界:deck 顶红色 → 发动后立即停止(获得 0 张)
//   5. 手牌上限豁免:获得 N 张黑牌后 handLimit = 体力 + N(本回合不计入上限)
//   6. 手牌上限豁免动态:获得后使用掉,豁免数随之减少
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import { handLimit } from '../../src/engine/hand-limit';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界甄姬',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界洛神'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发准备阶段:applyAtom(阶段开始, 0, 准备) → 洛神 after-hook 启动循环 */
async function triggerPreparePhase(harness: SkillTestHarness): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界洛神', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('正面:[♠, ♥] → 发动 → 获黑桃 → 继续 → 红桃停止且不获得(获 1 张)', async () => {
    const j1 = makeCard('j1', '杀', '♠', '5'); // 黑桃(黑)→ 获得
    const j2 = makeCard('j2', '桃', '♥', '3'); // 红桃(红)→ 停止不获得
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界洛神'] }),
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

    await triggerPreparePhase(harness);
    P1.expectPending('请求回应');

    await P1.respond('界洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应');

    // 继续 → 第二张红桃 → 自动停止(红色不获得)
    await P1.respond('界洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 仅获得黑桃 j1;红桃 j2 进弃牌堆
    expect(harness.state.players[0].hand).toContain('j1');
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.zones.discardPile).toContain('j2');
  });

  it('正面:[♠, ♣, ♥] → 两次黑桃获得 → 红桃停止不获得(获 2 张)', async () => {
    const j1 = makeCard('j1', '杀', '♠', '5');
    const j2 = makeCard('j2', '杀', '♣', '7');
    const j3 = makeCard('j3', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界洛神'] }),
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
    await P1.respond('界洛神', { choice: true }); // 发动
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应');
    await P1.respond('界洛神', { choice: true }); // 继续(♠)
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应');
    await P1.respond('界洛神', { choice: true }); // 继续(♣)
    await harness.waitForStable();
    harness.processAllEvents();
    // 第三张(♥红)→ 自动停止不获得

    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toContain('j1');
    expect(harness.state.players[0].hand).toContain('j2');
    expect(harness.state.zones.discardPile).toContain('j3');
  });

  it('负面:不发动(confirm=false) → 不判定,不获得牌', async () => {
    const j1 = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界洛神'] }),
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

    await P1.respond('界洛神', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(1);
  });

  it('边界:deck 顶为红色 → 发动后立即停止(获得 0 张)', async () => {
    const j1 = makeCard('j1', '桃', '♥', '3'); // 红桃(红)→ 停止不获得
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界洛神'] }),
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
    await P1.respond('界洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 红色判定 → 不获得,不询问继续
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 手牌上限豁免:以此法获得的牌本回合不计入手牌上限 ─────────────

  it('手牌上限豁免:获得 N 张黑牌后 handLimit = 体力 + N', async () => {
    // 体力 3,deck 顶 2 张黑牌 → 获得 2 张,均仍在手牌 → handLimit 应 = 3 + 2 = 5
    const j1 = makeCard('j1', '杀', '♠', '5');
    const j2 = makeCard('j2', '杀', '♣', '7');
    const j3 = makeCard('j3', '桃', '♥', '3'); // 红桃 → 停止
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界洛神'], health: 3 }),
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
    await P1.respond('界洛神', { choice: true }); // 发动
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应');
    await P1.respond('界洛神', { choice: true }); // 继续(♠)
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应');
    await P1.respond('界洛神', { choice: true }); // 继续(♣)
    await harness.waitForStable();
    harness.processAllEvents();
    // 第三张(♥红)→ 停止

    // 获得 j1, j2 两张;手牌 2 张,体力 3 → 豁免后 handLimit = 3 + 2 = 5
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(handLimit(harness.state, 0)).toBe(5);
  });

  it('手牌上限豁免:无洛神获得时 handLimit 回到默认(体力值)', async () => {
    // 不发动洛神 → 无豁免牌 → handLimit = 体力
    const j1 = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [],
          skills: ['界洛神'],
          health: 3,
        }),
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
    await P1.respond('界洛神', { choice: false }); // 不发动
    await harness.waitForStable();
    harness.processAllEvents();

    expect(handLimit(harness.state, 0)).toBe(3);
  });

  it('手牌上限豁免动态:获得后该牌离开手牌,豁免数随之减少', async () => {
    // 获得 2 张黑牌 → handLimit=5;把一张弃掉(模拟使用/弃置)→ 豁免数 -1 → handLimit=4
    const j1 = makeCard('j1', '杀', '♠', '5');
    const j2 = makeCard('j2', '杀', '♣', '7');
    const j3 = makeCard('j3', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界洛神'], health: 3 }),
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
    await P1.respond('界洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应');
    await P1.respond('界洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应');
    await P1.respond('界洛神', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(handLimit(harness.state, 0)).toBe(5); // 2 张豁免

    // 模拟本回合使用掉一张洛神获得的牌(直接经 移动牌 进弃牌堆,绕过出牌流程)
    await applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'j1',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    harness.processAllEvents();

    // j1 已不在手牌 → 豁免数只剩 1 → handLimit = 3 + 1 = 4
    expect(harness.state.players[0].hand).not.toContain('j1');
    expect(handLimit(harness.state, 0)).toBe(4);
  });
});
