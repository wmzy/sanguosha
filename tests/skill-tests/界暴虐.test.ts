// 界暴虐(界董卓·主公技)测试(界限突破版):
// 核心差异(相对标暴虐 src/engine/skills/暴虐.ts):
//   1. 触发条件:造成 **1 点** 伤害后(标版为"造成伤害后");本实现按字面 amount===1
//   2. 决策权:"你可以判定"(标版为"其可以令你判定")— 实现一致,均问董卓
//   3. 结算效果:黑桃 → 回复1点体力 **并获得此判定牌**(标版仅回复体力)
//
// 用例:
//   1. 其他群势力角色造成 1 点伤害 → 询问董卓 → confirm → 判定为黑桃 → 回复+获牌
//   2. 判定为非黑桃 → 不回复,不得牌
//   3. 取消判定 → 不判定,无效果
//   4. amount=2 伤害 → 不触发(字面"1 点"解读)
//   5. 自己造成伤害 → 不触发
//   6. 非群势力角色造成伤害 → 不触发
//   7. 非主公 → 不触发
//   8. 系统伤害(source<0)→ 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
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
  health?: number;
  maxHealth?: number;
  skills?: string[];
  faction?: '魏' | '蜀' | '吴' | '群';
  identity?: '主公' | '忠臣' | '反贼' | '内奸';
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界董卓',
    health: opts.health ?? 8,
    maxHealth: opts.maxHealth ?? 8,
    alive: true,
    hand: [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction ?? '群',
    identity: opts.identity ?? '反贼',
  };
}

/** 预填牌堆顶:判定时翻此牌 */
function preloadDeck(state: GameState, cardIds: string[]): void {
  state.zones.deck = [...cardIds, ...state.zones.deck];
}

describe('界暴虐', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 端到端:1点伤害 → confirm → 黑桃 → 回复+获牌 ────
  it('其他群角色造成1点伤害 → confirm → 判定黑桃 → 回复1点体力+获得判定牌', async () => {
    const judgeCard = makeCard('jc1', '杀', '♠', 'K'); // 牌堆顶 = 判定牌
    const state: GameState = createGameState({
      players: [
        // P0 界董卓(主公),受伤状态
        makePlayer({
          index: 0,
          name: 'P0',
          health: 5,
          maxHealth: 8,
          skills: ['界暴虐'],
          identity: '主公',
        }),
        // P1 群势力其他角色
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          faction: '群',
          health: 4,
          maxHealth: 4,
        }),
        // P2 受伤目标
        makePlayer({ index: 2, name: 'P2', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { jc1: judgeCard },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    preloadDeck(state, ['jc1']);
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p0HandBefore = harness.state.players[0].hand.length;

    // P1 对 P2 造成 1 点伤害(void fire-and-forget:after-hook 会创建 pending)
    void runDamageFlow(harness.state, 1, 2, 1);
    await harness.waitForStable();

    // 询问 P0(董卓)是否发动暴虐
    P0.expectPending('请求回应');
    const slot = [...harness.state.pendingSlots.values()][0];
    const atom = slot.atom as { requestType?: string };
    expect(atom.requestType).toBe('暴虐/confirm');

    // confirm 判定
    await P0.respond('界暴虐', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 验证:回复 1 点体力(5→6)
    expect(harness.state.players[0].health).toBe(6);
    // 验证:获得判定牌(手牌 +1,内容为黑桃 K 杀)
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore + 1);
    expect(harness.state.players[0].hand).toContain('jc1');
    // 验证:判定牌不在弃牌堆(被董卓拿走)
    expect(harness.state.zones.discardPile).not.toContain('jc1');
  });

  // ─── 2. 判定非黑桃 → 不回复、不得牌 ───────────────────
  it('判定为红桃 → 不回复体力,判定牌入弃牌堆', async () => {
    const judgeCard = makeCard('jc2', '杀', '♥', 'K'); // 红桃
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 5,
          maxHealth: 8,
          skills: ['界暴虐'],
          identity: '主公',
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          faction: '群',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { jc2: judgeCard },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    preloadDeck(state, ['jc2']);
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p0HandBefore = harness.state.players[0].hand.length;

    void runDamageFlow(harness.state, 1, 2, 1);
    await harness.waitForStable();
    P0.expectPending('请求回应');

    await P0.respond('界暴虐', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 不回复
    expect(harness.state.players[0].health).toBe(5);
    // 不得牌
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore);
    // 判定牌入弃牌堆
    expect(harness.state.zones.discardPile).toContain('jc2');
  });

  // ─── 3. 取消判定 → 不判定 ─────────────────────────────
  it('取消发动 → 不判定,无效果', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 5,
          maxHealth: 8,
          skills: ['界暴虐'],
          identity: '主公',
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          faction: '群',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p0HandBefore = harness.state.players[0].hand.length;
    const deckBefore = harness.state.zones.deck.length;

    void runDamageFlow(harness.state, 1, 2, 1);
    await harness.waitForStable();
    P0.expectPending('请求回应');

    await P0.respond('界暴虐', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无判定 → 无回复、无获牌、牌堆不变
    expect(harness.state.players[0].health).toBe(5);
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore);
    expect(harness.state.zones.deck.length).toBe(deckBefore);
  });

  // ─── 4. amount=2 → 不触发 ─────────────────────────────
  it('2点伤害(amount=2)→ 不触发界暴虐', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 5,
          maxHealth: 8,
          skills: ['界暴虐'],
          identity: '主公',
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          faction: '群',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 造成 2 点伤害
    await runDamageFlow(harness.state, 1, 2, 2);
    await harness.waitForStable();
    harness.processAllEvents();

    // 无询问
    expect(harness.state.pendingSlots.size).toBe(0);
    // P2 受 2 点伤害
    expect(harness.state.players[2].health).toBe(2);
  });

  // ─── 5. 自己造成伤害 → 不触发 ─────────────────────────
  it('董卓自己造成伤害 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 5,
          maxHealth: 8,
          skills: ['界暴虐'],
          identity: '主公',
          faction: '群',
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P0(董卓自己)造成伤害
    await runDamageFlow(harness.state, 0, 1, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 6. 非群势力角色造成伤害 → 不触发 ─────────────────
  it('非群势力(魏)角色造成伤害 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 5,
          maxHealth: 8,
          skills: ['界暴虐'],
          identity: '主公',
        }),
        // P1 是魏势力
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          faction: '魏',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await runDamageFlow(harness.state, 1, 2, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 7. 非主公 → 不触发 ───────────────────────────────
  it('董卓非主公身份 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        // P0 不是主公
        makePlayer({
          index: 0,
          name: 'P0',
          health: 5,
          maxHealth: 8,
          skills: ['界暴虐'],
          identity: '反贼',
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          faction: '群',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await runDamageFlow(harness.state, 1, 2, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 8. 系统伤害(source<0)→ 不触发 ────────────────────
  it('系统伤害(source=-1,如闪电)→ 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 5,
          maxHealth: 8,
          skills: ['界暴虐'],
          identity: '主公',
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          faction: '群',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 系统伤害(source=-1)
    await runDamageFlow(harness.state, -1, 1, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
