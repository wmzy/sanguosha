// 界势斩(界华雄·群·主动技)测试(界限突破版):
// 核心机制:出牌阶段限两次,令一名其他角色视为对华雄使用一张决斗。
//
// 决斗语义(runDuelResolution):
//   from(发起者/出杀后手)= 势斩的目标(其他角色)
//   target(目标/出杀先手) = 华雄(自己)
//   → 华雄先被询问出杀,然后是目标,轮流出杀,先不出者受 1 点伤害。
//
// 用例:
//   1. 华雄不出杀 → 华雄输,受 1 伤(目标未伤)
//   2. 双方轮流出杀后华雄先不出 → 华雄扣血
//   3. 目标不出杀,华雄出杀 → 目标输扣血
//   4. 限两次:第三次被拒
//   5. 不能以自己为目标
//   6. 非自己回合/非出牌阶段 → 拒绝
//   7. 跳过无懈可击:持无懈也不能抵消(与离间/翦灭一致的"视为使用"惯例)
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
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界华雄',
    health: opts.health ?? 6,
    maxHealth: opts.maxHealth ?? 6,
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

function buildState(opts?: {
  p0Hand?: string[];
  p1Hand?: string[];
  extraCards?: Record<string, Card>;
  p0Health?: number;
}): GameState {
  const cards: Record<string, Card> = { ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P0',
        character: '界华雄',
        // 华雄需拥有 '杀' 技能才能在决斗中 respond 出杀(respond 走 skillId='杀')
        skills: ['界势斩', '杀'],
        hand: opts?.p0Hand ?? [],
        health: opts?.p0Health ?? 6,
        maxHealth: 6,
      }),
      makePlayer({
        index: 1,
        name: 'P1',
        character: '曹操',
        skills: ['杀'],
        hand: opts?.p1Hand ?? [],
        health: 4,
        maxHealth: 4,
      }),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界势斩', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 华雄不出杀 → 华雄输扣血 ──────────────────────────
  it('华雄不出杀 → 华雄扣 1 血', async () => {
    const state = buildState();
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p0HealthBefore = harness.state.players[0].health;
    const p1HealthBefore = harness.state.players[1].health;

    await P0.triggerAction('界势斩', 'use', { target: 1 });

    // 华雄(目标/先手)被询问出杀
    const P0Session = harness.player('P0');
    P0Session.expectPending('询问杀');
    await P0Session.pass();

    // 华雄输 → 受 1 点伤害(来源=P1)
    expect(harness.state.players[0].health).toBe(p0HealthBefore - 1);
    expect(harness.state.players[1].health).toBe(p1HealthBefore); // P1 无伤
  });

  // ─── 2. 双方轮流出杀后华雄先不出 → 华雄扣血 ───────────────
  it('华雄出杀→P1 出杀→华雄再被询问→pass→华雄扣 1 血', async () => {
    const s0 = makeCard('s0', '杀', '♠', '5');
    const s1 = makeCard('s1', '杀', '♣', '7');
    const state = buildState({
      p0Hand: ['s0'],
      p1Hand: ['s1'],
      extraCards: { s0, s1 },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p0HealthBefore = harness.state.players[0].health;
    const p1HealthBefore = harness.state.players[1].health;

    await P0.triggerAction('界势斩', 'use', { target: 1 });

    // 华雄先出杀
    P0.expectPending('询问杀');
    await P0.respond('杀', { cardId: 's0' });

    // P1 出杀
    P1.expectPending('询问杀');
    await P1.respond('杀', { cardId: 's1' });

    // 华雄再被询问 → pass(无杀可出)
    P0.expectPending('询问杀');
    await P0.pass();

    // 华雄输 → 扣 1 血
    expect(harness.state.players[0].health).toBe(p0HealthBefore - 1);
    expect(harness.state.players[1].health).toBe(p1HealthBefore);
    expect(harness.state.zones.discardPile).toContain('s0');
    expect(harness.state.zones.discardPile).toContain('s1');
  });

  // ─── 3. 目标(P1)不出杀 → P1 输扣血 ─────────────────────────
  it('华雄出杀→P1 不出 → P1 扣 1 血', async () => {
    const s0 = makeCard('s0', '杀', '♠', '5');
    const state = buildState({
      p0Hand: ['s0'],
      p1Hand: [],
      extraCards: { s0 },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p0HealthBefore = harness.state.players[0].health;
    const p1HealthBefore = harness.state.players[1].health;

    await P0.triggerAction('界势斩', 'use', { target: 1 });

    // 华雄先被询问出杀 → 出杀
    P0.expectPending('询问杀');
    await P0.respond('杀', { cardId: 's0' });

    // P1 被询问 → pass
    const P1 = harness.player('P1');
    P1.expectPending('询问杀');
    await P1.pass();

    // P1 输 → 扣 1 血(来源=华雄)
    expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
    expect(harness.state.players[0].health).toBe(p0HealthBefore); // 华雄无伤
    expect(harness.state.zones.discardPile).toContain('s0');
  });

  // ─── 4. 限两次:第三次被拒 ─────────────────────────────
  it('限两次:第三次被拒', async () => {
    const state = buildState();
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次
    await P0.triggerAction('界势斩', 'use', { target: 1 });
    P0.expectPending('询问杀');
    await P0.pass();
    expect(harness.state.players[0].health).toBe(5);

    // 第二次(允许)
    await P0.triggerAction('界势斩', 'use', { target: 1 });
    P0.expectPending('询问杀');
    await P0.pass();
    expect(harness.state.players[0].health).toBe(4);

    // 第三次 → 被拒
    await P0.expectRejected({
      skillId: '界势斩',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 5. 不能以自己为目标 ─────────────────────────────────
  it('不能以自己为目标', async () => {
    const state = buildState();
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界势斩',
      actionType: 'use',
      params: { target: 0 },
    });
  });

  // ─── 6. 非自己回合 → 拒绝 ──────────────────────────────
  it('非自己回合 → 拒绝', async () => {
    const state = buildState();
    state.currentPlayerIndex = 1; // P1 回合
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界势斩',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 7. 非出牌阶段 → 拒绝 ──────────────────────────────
  it('非出牌阶段 → 拒绝', async () => {
    const state = buildState();
    state.phase = '弃牌';
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界势斩',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 8. 跳过无懈可击:持无懈也不能抵消 ─────────────────────
  it('P1 持无懈可击 → 势斩决斗仍直接结算(不可被无懈抵消)', async () => {
    const wx = makeCard('wx1', '无懈可击', '♣', 'J', '锦囊牌');
    const state = buildState({
      p1Hand: ['wx1'],
      extraCards: { wx1: wx },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p0HealthBefore = harness.state.players[0].health;

    await P0.triggerAction('界势斩', 'use', { target: 1 });

    // 无无懈窗口:华雄直接被询问出杀
    P0.expectPending('询问杀');
    await P0.pass();

    // 华雄输 → 扣 1 血(无懈未能抵消)
    expect(harness.state.players[0].health).toBe(p0HealthBefore - 1);
    // P1 的无懈可击仍在手(未被消耗)
    expect(harness.state.players[1].hand).toContain('wx1');
  });

  // ─── 9. 与界耀武协同:决斗中华雄受伤 → 触发耀武摸牌(无 cardId→华雄摸)───
  it('协同:决斗华雄受伤 → 界耀武触发,华雄摸 1 张', async () => {
    const topCard = makeCard('top1', '闪', '♠', '2');
    const state = buildState();
    // 把界耀武也加给华雄
    state.players[0].skills = ['界势斩', '界耀武', '杀'];
    state.cardMap = { top1: topCard };
    state.zones.deck = ['top1'];
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p0HandBefore = harness.state.players[0].hand.length;

    await P0.triggerAction('界势斩', 'use', { target: 1 });
    P0.expectPending('询问杀');
    await P0.pass();

    // 华雄受 1 伤(血 6→5),触发界耀武(决斗无 cardId → 非红色 → 华雄摸 1)
    expect(harness.state.players[0].health).toBe(5);
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore + 1);
    expect(harness.state.players[0].hand).toContain('top1');
  });
});
