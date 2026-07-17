// tests/skill-tests/飘零.test.ts
// 飘零(界小乔·被动技):结束阶段，你可以判定，若结果为红桃，
//   你将判定牌置于牌堆顶或交给一名角色，若该角色是你，你弃置一张牌。
//
// 官方来源:三国杀 OL 界限突破 hero/457。
//
// 验证:
//   1. 红桃判定 → 交给其他角色:判定牌进入目标手牌
//   2. 红桃判定 → 置牌堆顶:判定牌回到牌堆
//   3. 红桃判定 → 给自己:判定牌入手 + 弃1张手牌
//   4. 非红桃判定:无效果(判定牌留在弃牌堆)
//   5. 不发动判定:跳过
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
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
    character: '界小乔',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? opts.health ?? 3,
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

/** 触发飘零:直接 applyAtom 阶段开始(回合结束)= 结束阶段开始 */
async function triggerEndPhase(harness: SkillTestHarness): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('飘零', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 红桃判定 → 交给其他角色 ──────────────────────────────
  it('红桃判定 → 交给 P1 → 判定牌进入 P1 手牌', async () => {
    const judgeCard = makeCard('j1', '杀', '♥', '7'); // 红桃判定牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界小乔', skills: ['飘零'] }),
        makePlayer({ index: 1, name: 'P1', skills: [], hand: [] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界小乔');

    await triggerEndPhase(harness);

    // 询问是否判定
    P0.expectPending('请求回应');
    await P0.respond('飘零', { choice: true }); // 发动判定

    // 判定完成(红桃)→ 询问是否交给角色
    P0.expectPending('请求回应');
    await P0.respond('飘零', { choice: true }); // 交给角色

    // 选目标 P1
    P0.expectPending('请求回应');
    await P0.respond('飘零', { target: 1 });

    // 判定牌进入 P1 手牌
    expect(harness.state.players[1].hand).toContain('j1');
    expect(harness.state.zones.discardPile).not.toContain('j1');
  });

  // ─── 2. 红桃判定 → 置牌堆顶 ──────────────────────────────────
  it('红桃判定 → 置牌堆顶 → 判定牌回到牌堆', async () => {
    const judgeCard = makeCard('j1', '杀', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界小乔', skills: ['飘零'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界小乔');

    await triggerEndPhase(harness);

    P0.expectPending('请求回应');
    await P0.respond('飘零', { choice: true }); // 发动判定

    P0.expectPending('请求回应');
    await P0.respond('飘零', { choice: false }); // 不交给 → 置牌堆顶

    // 判定牌回到牌堆(不在弃牌堆)
    expect(harness.state.zones.deck).toContain('j1');
    expect(harness.state.zones.discardPile).not.toContain('j1');
  });

  // ─── 3. 红桃判定 → 给自己 → 弃1张 ────────────────────────────
  it('红桃判定 → 给自己 → 判定牌入手 + 弃1张手牌', async () => {
    const judgeCard = makeCard('j1', '杀', '♥', '7');
    const existing = makeCard('c1', '闪', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界小乔', skills: ['飘零'], hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judgeCard, c1: existing },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界小乔');

    await triggerEndPhase(harness);

    P0.expectPending('请求回应');
    await P0.respond('飘零', { choice: true }); // 发动判定

    P0.expectPending('请求回应');
    await P0.respond('飘零', { choice: true }); // 交给角色

    // 选目标=自己
    P0.expectPending('请求回应');
    await P0.respond('飘零', { target: 0 });

    // 自己先获得判定牌(手牌 c1 + j1 = 2 张)
    expect(harness.state.players[0].hand).toContain('j1');

    // 询问弃一张手牌
    P0.expectPending('请求回应');
    await P0.respond('飘零', { cardId: 'c1' });

    // c1 被弃
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c1');
    // j1 仍在手牌
    expect(harness.state.players[0].hand).toContain('j1');
  });

  // ─── 4. 非红桃判定 → 无效果 ──────────────────────────────────
  it('非红桃判定(黑桃) → 无效果,判定牌留在弃牌堆', async () => {
    const judgeCard = makeCard('j1', '杀', '♣', '7'); // 梅花(非红桃)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界小乔', skills: ['飘零'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界小乔');

    await triggerEndPhase(harness);

    P0.expectPending('请求回应');
    await P0.respond('飘零', { choice: true }); // 发动判定

    // 非红桃 → 无后续询问(飘零流程结束)
    expect(harness.state.pendingSlots.size).toBe(0);
    // 判定牌在弃牌堆
    expect(harness.state.zones.discardPile).toContain('j1');
    // P1 未获得牌
    expect(harness.state.players[1].hand.length).toBe(0);
  });

  // ─── 5. 不发动判定 ────────────────────────────────────────────
  it('不发动飘零判定 → 直接跳过,无判定发生', async () => {
    const judgeCard = makeCard('j1', '杀', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界小乔', skills: ['飘零'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界小乔');

    await triggerEndPhase(harness);

    P0.expectPending('请求回应');
    await P0.respond('飘零', { choice: false }); // 不发动

    // 无判定发生:牌堆顶仍是 j1
    expect(harness.state.zones.deck).toContain('j1');
    expect(harness.state.zones.discardPile).not.toContain('j1');
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
