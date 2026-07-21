// 界樵拾(界夏侯氏·被动技,OL 界限突破官方逐字)测试:
//   每个结束阶段，你可以与当前回合角色各摸一张牌。然后若其与你手牌数不相等，此技能本轮失效。
//
// 验证:
//   1. 他人结束阶段发动:owner 与当前回合角色各摸 1,手牌数不相等 → 本轮失效
//   2. 他人结束阶段发动:手牌数相等 → 不失效
//   3. 他人结束阶段发动后本轮失效 → 再次触发(同轮)被跳过
//   4. 不发动(取消)→ 无副作用、不失效
//   5. 自己结束阶段发动:owner == 当前回合角色,只摸 1,手牌数必相等 → 不失效
//   6. owner 死亡 → 不触发
//   7. 新轮开始 → 失效标记自动恢复
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json, TurnPhase } from '../../src/engine/types';

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
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  skills?: string[];
  vars?: Record<string, Json>;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

interface BuildOpts {
  p0Hand?: string[];
  p1Hand?: string[];
  p1Character?: string;
  p0Alive?: boolean;
  p1Alive?: boolean;
  currentPlayer?: number;
  phase?: TurnPhase;
  round?: number;
  extraCards?: Record<string, Card>;
  deck?: string[];
}

function buildState(opts: BuildOpts = {}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: '界夏侯氏',
        character: '界夏侯氏',
        health: 3,
        maxHealth: 3,
        alive: opts.p0Alive ?? true,
        hand: opts.p0Hand ?? [],
        skills: ['界樵拾'],
      }),
      makePlayer({
        index: 1,
        name: 'P1',
        character: opts.p1Character ?? '曹操',
        health: 4,
        maxHealth: 4,
        hand: opts.p1Hand ?? [],
        alive: opts.p1Alive ?? true,
      }),
    ],
    cardMap: opts.extraCards ?? {},
    zones: { deck: opts.deck ?? [], discardPile: [], processing: [] },
    currentPlayerIndex: opts.currentPlayer ?? 1,
    phase: opts.phase ?? '回合结束',
    turn: { round: opts.round ?? 1, phase: opts.phase ?? '回合结束', vars: {} },
  });
}

/** 推进到 currentPlayer 的结束阶段,触发樵拾 hook */
async function endPhaseTrigger(harness: SkillTestHarness, player: number): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '回合结束' });
  await harness.waitForStable();
}

describe('界樵拾(OL 界限突破版)', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 他人结束阶段发动:各摸 1,手牌数不等 → 本轮失效 ─────────
  it('他人结束阶段发动:owner 与回合角色各摸 1,手牌数不等 → 本轮失效', async () => {
    // deck 顶两张(末尾为顶):d1(底)、d2(顶)
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪');
    // P0 手牌 2 张,P1 手牌 0 张;摸 1 后 P0=3, P1=1,不等 → 失效
    const state = buildState({
      p0Hand: ['h1', 'h2'],
      p1Hand: [],
      currentPlayer: 1,
      round: 1,
      extraCards: {
        h1: makeCard('h1', '杀'),
        h2: makeCard('h2', '闪'),
        d1,
        d2,
      },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await endPhaseTrigger(harness, 1);
    P0.expectPending('请求回应');
    await P0.respond('界樵拾', { choice: true });
    await harness.waitForStable();

    // 各摸一张:P0 摸到 deck 顶 d2,P1 摸到 d1
    expect(harness.state.players[0].hand).toContain('d2');
    expect(harness.state.players[1].hand).toContain('d1');
    // 手牌数 P0=3,P1=1,不等 → 本轮失效
    expect(harness.state.players[0].hand.length).toBe(3);
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.localVars['界樵拾/disabledRound/0']).toBe(1);
  });

  // ─── 2. 他人结束阶段发动:手牌数相等 → 不失效 ─────────
  it('他人结束阶段发动:摸后手牌数相等 → 不失效', async () => {
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪');
    // P0 手牌 1 张,P1 手牌 1 张;各摸 1 后均=2,相等 → 不失效
    const state = buildState({
      p0Hand: ['h1'],
      p1Hand: ['h2'],
      currentPlayer: 1,
      round: 1,
      extraCards: {
        h1: makeCard('h1', '杀'),
        h2: makeCard('h2', '闪'),
        d1,
        d2,
      },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await endPhaseTrigger(harness, 1);
    P0.expectPending('请求回应');
    await P0.respond('界樵拾', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[1].hand.length).toBe(2);
    expect(harness.state.localVars['界樵拾/disabledRound/0']).toBeUndefined();
  });

  // ─── 3. 本轮失效后,同轮再次触发不询问 ─────────
  it('本轮失效后,同轮再次进入结束阶段不触发', async () => {
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪');
    const state = buildState({
      p0Hand: ['h1', 'h2'],
      p1Hand: [],
      currentPlayer: 1,
      round: 1,
      extraCards: {
        h1: makeCard('h1', '杀'),
        h2: makeCard('h2', '闪'),
        d1,
        d2,
      },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    // 第一次发动 → 手牌不等 → 失效
    await endPhaseTrigger(harness, 1);
    await P0.respond('界樵拾', { choice: true });
    await harness.waitForStable();
    expect(harness.state.localVars['界樵拾/disabledRound/0']).toBe(1);

    // 同轮再次触发(模拟下家结束阶段):应跳过(无 pending)
    await endPhaseTrigger(harness, 1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 4. 不发动(取消)→ 无副作用、不失效 ─────────
  it('不发动(取消)→ 无摸牌、不失效', async () => {
    const state = buildState({
      p0Hand: ['h1', 'h2'],
      p1Hand: [],
      currentPlayer: 1,
      round: 1,
      extraCards: {
        h1: makeCard('h1', '杀'),
        h2: makeCard('h2', '闪'),
      },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await endPhaseTrigger(harness, 1);
    P0.expectPending('请求回应');
    await P0.respond('界樵拾', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toEqual(['h1', 'h2']);
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.localVars['界樵拾/disabledRound/0']).toBeUndefined();
  });

  // ─── 5. 自己结束阶段发动:owner == 回合角色,只摸 1,必相等 ─────────
  it('自己结束阶段发动:owner 摸 1(无双倍),手牌数必相等 → 不失效', async () => {
    const d1 = makeCard('d1', '杀');
    const state = buildState({
      p0Hand: ['h1'],
      p1Hand: [],
      currentPlayer: 0, // owner 自己的回合
      round: 1,
      extraCards: { h1: makeCard('h1', '杀'), d1 },
      deck: ['d1'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await endPhaseTrigger(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界樵拾', { choice: true });
    await harness.waitForStable();

    // owner 摸 1(自己==回合角色,只一次)
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[1].hand).toEqual([]);
    // owner.hand.length(2) == owner.hand.length(2) → 不失效
    expect(harness.state.localVars['界樵拾/disabledRound/0']).toBeUndefined();
  });

  // ─── 6. owner 死亡 → 不触发 ─────────
  it('owner 死亡 → 不触发', async () => {
    const state = buildState({
      p0Hand: ['h1'],
      p1Hand: [],
      p0Alive: false,
      currentPlayer: 1,
      round: 1,
      extraCards: { h1: makeCard('h1', '杀') },
      deck: [],
    });
    await harness.setup(state);

    await endPhaseTrigger(harness, 1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 7. 新轮 → 失效标记自动恢复 ─────────
  it('同轮失效,进入新轮 → 失效标记不再阻碍触发', async () => {
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪');
    // 第一轮已失效(round=1,disabledRound=1),进入第二轮:再次触发应正常询问
    const state = buildState({
      p0Hand: ['h1', 'h2'],
      p1Hand: [],
      currentPlayer: 1,
      round: 2, // 新轮
      extraCards: {
        h1: makeCard('h1', '杀'),
        h2: makeCard('h2', '闪'),
        d1,
        d2,
      },
      deck: ['d1', 'd2'],
    });
    // 模拟上一轮已失效:localVars 设为 round 1
    state.localVars = { '界樵拾/disabledRound/0': 1 };
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await endPhaseTrigger(harness, 1);
    // 进入新轮(round=2 != 失效轮次 1)→ 应正常询问
    P0.expectPending('请求回应');
    await P0.respond('界樵拾', { choice: false });
    await harness.waitForStable();
  });
});
