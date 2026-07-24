// 界燕语(界夏侯氏·主动技,OL 界限突破官方逐字)测试:
//   出牌阶段，你可以重铸【杀】。出牌阶段结束时，若你本阶段失去过至少两张【杀】，
//   你可以令一名男性角色摸两张牌。
//
// 验证:
//   1. 重铸【杀】:弃杀 + 摸一张(净手牌数不变,但杀 → 新牌)
//   2. 重铸非【杀】牌(闪)→ 拒绝
//   3. 非出牌阶段重铸 → 拒绝
//   4. 非自己回合重铸 → 拒绝
//   5. 出牌阶段失去过 ≥2 杀(2 次重铸)→ 阶段结束触发,令男性摸 2
//   6. 出牌阶段失去过 <2 杀(只重铸 1 次)→ 不触发
//   7. 出牌阶段用 2 张杀(出杀,非重铸)→ 也触发(界版"失去过",标版只算重铸)
//   8. 阶段结束触发:无男性存活 → 不询问
//   9. 选目标为女性 → 拒绝
//  10. 阶段结束触发后取消 → 无副作用
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
  p1Character?: string;
  p1Hand?: string[];
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
        hand: opts.p0Hand ?? [],
        skills: ['界燕语'],
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
    currentPlayerIndex: opts.currentPlayer ?? 0,
    phase: opts.phase ?? '出牌',
    turn: { round: opts.round ?? 1, phase: opts.phase ?? '出牌', vars: {} },
  });
}

describe('界燕语(OL 界限突破版)', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 重铸【杀】:弃杀 + 摸一张 ─────────
  it('重铸杀:弃杀,摸一张(净手牌数不变,杀→新牌)', async () => {
    // deck 末尾为顶,故 [dBase(底), dTop(顶)] → 摸 dTop
    const s1 = makeCard('s1', '杀', '♠');
    const dTop = makeCard('dTop', '闪', '♦');
    const dBase = makeCard('dBase', '桃', '♥');
    const state = buildState({
      p0Hand: ['s1'],
      extraCards: { s1, dTop, dBase },
      deck: ['dBase', 'dTop'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.triggerAction('界燕语', 'recycle', { cardId: 's1' });
    await harness.waitForStable();

    expect(harness.state.zones.discardPile).toContain('s1');
    expect(harness.state.players[0].hand).not.toContain('s1');
    expect(harness.state.players[0].hand).toContain('dTop');
    expect(harness.state.players[0].hand).toHaveLength(1);
  });

  // ─── 2. 重铸非【杀】牌 → 拒绝 ─────────
  it('重铸非杀牌(闪)→ 拒绝', async () => {
    const f1 = makeCard('f1', '闪', '♦');
    const state = buildState({
      p0Hand: ['f1'],
      extraCards: { f1 },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.expectRejected({
      skillId: '界燕语',
      actionType: 'recycle',
      params: { cardId: 'f1' },
    });
    expect(harness.state.players[0].hand).toContain('f1');
  });

  // ─── 3. 非出牌阶段重铸 → 拒绝 ─────────
  it('非出牌阶段(摸牌)重铸 → 拒绝', async () => {
    const s1 = makeCard('s1', '杀');
    const state = buildState({
      p0Hand: ['s1'],
      phase: '摸牌',
      extraCards: { s1 },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.expectRejected({
      skillId: '界燕语',
      actionType: 'recycle',
      params: { cardId: 's1' },
    });
  });

  // ─── 4. 非自己回合重铸 → 拒绝 ─────────
  it('非自己回合重铸 → 拒绝', async () => {
    const s1 = makeCard('s1', '杀');
    const state = buildState({
      p0Hand: ['s1'],
      currentPlayer: 1, // P1 回合
      extraCards: { s1 },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.expectRejected({
      skillId: '界燕语',
      actionType: 'recycle',
      params: { cardId: 's1' },
    });
  });

  // ─── 5. 重铸 2 张杀 → 阶段结束触发,令男性摸 2 ─────────
  it('重铸 2 张杀 → 阶段结束触发,令男性摸 2 张', async () => {
    // P0 手牌 [s1, s2];deck 顶 [r1, r2](各重铸后摸到)
    const s1 = makeCard('s1', '杀');
    const s2 = makeCard('s2', '杀');
    // deck 末尾为顶:[base, r2, r1] → 先摸 r1,再摸 r2(每次重铸摸一张)
    // 之后阶段结束触发,P1 摸 2 张(m1, m2 顶上)
    const r1 = makeCard('r1', '闪');
    const r2 = makeCard('r2', '闪');
    const m1 = makeCard('m1', '桃');
    const m2 = makeCard('m2', '桃');
    const base = makeCard('base', '杀');
    const state = buildState({
      p0Hand: ['s1', 's2'],
      extraCards: { s1, s2, r1, r2, m1, m2, base },
      deck: ['base', 'm2', 'm1', 'r2', 'r1'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.triggerAction('界燕语', 'recycle', { cardId: 's1' });
    await harness.waitForStable();
    await P0.triggerAction('界燕语', 'recycle', { cardId: 's2' });
    await harness.waitForStable();

    // lostSha 计数应为 2
    expect(harness.state.players[0].vars['界燕语/lostShaThisPhase']).toBe(2);

    // 进入阶段结束(出牌) → 触发询问
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界燕语', { choice: true });
    await harness.waitForStable();
    // 选男性目标 P1
    P0.expectPending('请求回应');
    await P0.respond('界燕语', { target: 1 });
    await harness.waitForStable();

    // P1 摸 2 张(deck 顶 m1, m2)
    expect(harness.state.players[1].hand).toContain('m1');
    expect(harness.state.players[1].hand).toContain('m2');
    expect(harness.state.players[1].hand.length).toBe(2);
  });

  // ─── 6. 重铸 < 2 张杀 → 不触发 ─────────
  it('只重铸 1 张杀 → 阶段结束不触发', async () => {
    const s1 = makeCard('s1', '杀');
    const r1 = makeCard('r1', '闪');
    const state = buildState({
      p0Hand: ['s1'],
      extraCards: { s1, r1 },
      deck: ['r1'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.triggerAction('界燕语', 'recycle', { cardId: 's1' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['界燕语/lostShaThisPhase']).toBe(1);

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    // 无询问(lostSha<2)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 7. 出杀(非重铸)2 张也算"失去"→ 触发 ─────────
  it('出 2 张杀(使用,非重铸)→ 阶段结束触发(界版"失去过"语义)', async () => {
    // P0 出 2 张杀(需杀技能);P1 男性
    // 杀.use 会把 杀 移到手牌→处理区,触发 移动牌 hook → lostSha+1
    const s1 = makeCard('s1', '杀');
    const s2 = makeCard('s2', '杀');
    const state = buildState({
      p0Hand: ['s1', 's2'],
      p1Character: '曹操',
      p1Hand: [],
      extraCards: { s1, s2 },
      deck: [],
    });
    // 需要给 P0 加上"杀"技能才能出杀
    state.players[0].skills.push('杀');
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');
    const P1 = harness.player('P1');

    // 出第一张杀:P1 不出闪
    await P0.useCardAndTarget('杀', 's1', [1]);
    await harness.waitForStable();
    await P1.pass();
    await harness.waitForStable();
    // 出第二张杀(连弩效果跳过 - 这里需要绕过 quota,改用 respond 路径)
    // 默认 quota=1,第二张会被拒绝。改用直接 dispatch + 把 quota 设大
    harness.state.turn.vars['杀/quotaUsed'] = 0; // 重置 quota
    await P0.useCardAndTarget('杀', 's2', [1]);
    await harness.waitForStable();
    await P1.pass();
    await harness.waitForStable();

    // lostSha 应为 2(2 次出杀各 +1)
    expect(harness.state.players[0].vars['界燕语/lostShaThisPhase']).toBe(2);

    // 触发阶段结束(出牌) → 询问
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    // 因 deck 空,问 male 后摸 2 走 harness 自动补牌(test deck)
    P0.expectPending('请求回应');
    await P0.respond('界燕语', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界燕语', { target: 1 });
    await harness.waitForStable();

    // P1 摸 2 张(deck 由 harness 自动补,具体 id 不验)
    expect(harness.state.players[1].hand.length).toBe(2);
  });

  // ─── 8. 阶段结束触发:无男性存活 → 不询问 ─────────
  it('失去 2 杀但无男性存活 → 不询问', async () => {
    const s1 = makeCard('s1', '杀');
    const s2 = makeCard('s2', '杀');
    const r1 = makeCard('r1', '闪');
    const r2 = makeCard('r2', '闪');
    const state = buildState({
      p0Hand: ['s1', 's2'],
      // 甄姬为女性
      p1Character: '甄姬',
      extraCards: { s1, s2, r1, r2 },
      deck: ['r2', 'r1'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.triggerAction('界燕语', 'recycle', { cardId: 's1' });
    await harness.waitForStable();
    await P0.triggerAction('界燕语', 'recycle', { cardId: 's2' });
    await harness.waitForStable();

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    // P1(甄姬)为女性 → 无男性存活 → 不询问
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 9. 选目标为女性 → 拒绝 ─────────
  it('选目标为女性 → 拒绝', async () => {
    const s1 = makeCard('s1', '杀');
    const s2 = makeCard('s2', '杀');
    const r1 = makeCard('r1', '闪');
    const r2 = makeCard('r2', '闪');
    const state = buildState({
      p0Hand: ['s1', 's2'],
      p1Character: '甄姬', // 女性
      extraCards: { s1, s2, r1, r2 },
      deck: ['r2', 'r1'],
    });
    // 加第三个玩家为男性,使 hasMaleAlive=true 进入询问
    state.players.push(
      makePlayer({
        index: 2,
        name: 'P2',
        character: '曹操',
        health: 4,
        maxHealth: 4,
      }),
    );
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.triggerAction('界燕语', 'recycle', { cardId: 's1' });
    await harness.waitForStable();
    await P0.triggerAction('界燕语', 'recycle', { cardId: 's2' });
    await harness.waitForStable();

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界燕语', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    // 选 P1(甄姬,女性)→ 应被拒绝
    await P0.expectRejected({
      skillId: '界燕语',
      actionType: 'respond',
      params: { target: 1 },
    });
  });

  // ─── 10. 阶段结束触发后取消(不发动)→ 无副作用 ─────────
  it('阶段结束触发后取消 → 无副作用', async () => {
    const s1 = makeCard('s1', '杀');
    const s2 = makeCard('s2', '杀');
    const r1 = makeCard('r1', '闪');
    const r2 = makeCard('r2', '闪');
    const state = buildState({
      p0Hand: ['s1', 's2'],
      p1Character: '曹操',
      extraCards: { s1, s2, r1, r2 },
      deck: ['r2', 'r1'],
    });
    await harness.setup(state);
    const P0 = harness.player('界夏侯氏');

    await P0.triggerAction('界燕语', 'recycle', { cardId: 's1' });
    await harness.waitForStable();
    await P0.triggerAction('界燕语', 'recycle', { cardId: 's2' });
    await harness.waitForStable();

    const p1HandBefore = harness.state.players[1].hand.length;
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界燕语', { choice: false });
    await harness.waitForStable();

    // P1 不摸牌
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore);
  });

  // ─── 11. lostSha 计数在出牌阶段开始时重置 ─────────
  it('出牌阶段开始 → lostSha 重置为 0', async () => {
    const state = buildState({
      p0Hand: [],
      extraCards: {},
      deck: [],
    });
    // 预置 vars 为旧值
    state.players[0].vars['界燕语/lostShaThisPhase'] = 99;
    await harness.setup(state);

    // 模拟阶段开始(出牌)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['界燕语/lostShaThisPhase']).toBe(0);
  });
});
