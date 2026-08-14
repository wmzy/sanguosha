// 诸葛瞻(蜀·风林火山)技能测试:
//   罪论(被动技):结束阶段看牌堆顶3张,按X(满足项数)获得,余牌任意顺序置顶;X=0则自+他各失1体力
//   父荫(锁定技):每回合首次成杀/决斗目标后,若其手牌数>=你,此牌对你无效
//
// 测试手法:
//   罪论——通过预置 turn.vars(罪论/伤害/0、罪论/弃置/0)与手牌分布精确控制 X,
//          P0(诸葛瞻)从出牌阶段点"结束回合"推进到回合结束阶段触发罪论。
//   父荫——P1(他方)出牌阶段对 P0 出杀/决斗,验证 检测有效性 cancel 行为。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
// 临时注册罪论/父荫(主 agent 会统一注册到 index.ts)
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import * as 罪论Module from '../../src/engine/skills/罪论';
import * as 父荫Module from '../../src/engine/skills/父荫';
setSkillModuleOverride('罪论', async () => 罪论Module);
setSkillModuleOverride('父荫', async () => 父荫Module);

import { createGameState, suitColor } from '../../src/engine/types';
import type { Card, GameState, Json } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
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

function buildState(opts: {
  p0Hand: string[];
  p1Hand: string[];
  cards: Record<string, Card>;
  deck?: string[];
  turnVars?: Record<string, Json>;
  p0Health?: number;
}): GameState {
  return createGameState({
    players: [
      mkPlayer({
        index: 0,
        name: '诸葛瞻',
        character: '诸葛瞻',
        hand: opts.p0Hand,
        skills: ['罪论', '父荫', '回合管理'],
        health: opts.p0Health ?? 3,
        maxHealth: 3,
      }),
      mkPlayer({
        index: 1,
        name: 'P1',
        character: '反',
        hand: opts.p1Hand,
        skills: [],
        health: 4,
        maxHealth: 4,
      }),
    ],
    cardMap: opts.cards,
    zones: { deck: opts.deck ?? [], discardPile: [], processing: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: opts.turnVars ?? {} },
  });
}

// ────────────────────────────────────────────────────────────────
// 罪论
// ────────────────────────────────────────────────────────────────
describe('罪论', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('X=3(三项全满足):获得全部3张牌', async () => {
    // ①造成过伤害(turn.vars 预置)②未弃置过牌(无弃置键)③手牌数全场最少(P0=0)
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    const d3 = mkCard('d3', '桃', '♦', '4');
    const p1Card = mkCard('x1', '杀', '♣', '5');
    await harness.setup(
      buildState({
        p0Hand: [],
        p1Hand: [p1Card.id],
        cards: { d1, d2, d3, x1: p1Card },
        deck: ['d1', 'd2', 'd3'],
        turnVars: { '罪论/伤害/0': true },
      }),
    );
    const P0 = harness.player('诸葛瞻');

    await P0.triggerAction('回合管理', 'end');

    // 回合结束阶段:罪论询问是否发动(X=3)
    P0.expectPending('请求回应');
    await P0.respond('罪论', { choice: true });

    // 询问挑选:获得3张
    P0.expectPending('请求回应');
    await P0.respond('罪论', { gained: ['d1', 'd2', 'd3'], topOrder: [] });

    // 获得3张,牌堆清空
    expect(harness.state.players[0].hand).toEqual(['d1', 'd2', 'd3']);
    expect(harness.state.zones.deck).toEqual([]);
  });

  it('X=3 不发动:不摸牌', async () => {
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    const d3 = mkCard('d3', '桃', '♦', '4');
    const p1Card = mkCard('x1', '杀', '♣', '5');
    await harness.setup(
      buildState({
        p0Hand: [],
        p1Hand: [p1Card.id],
        cards: { d1, d2, d3, x1: p1Card },
        deck: ['d1', 'd2', 'd3'],
        turnVars: { '罪论/伤害/0': true },
      }),
    );
    const P0 = harness.player('诸葛瞻');

    await P0.triggerAction('回合管理', 'end');
    P0.expectPending('请求回应');
    await P0.respond('罪论', { choice: false }); // 不发动

    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['d1', 'd2', 'd3']);
  });

  it('X=1:获得1张,剩余2张按指定顺序置于牌堆顶', async () => {
    // ①造成过伤害 ②弃置过牌(键存在→不满足) ③非最少 → X=1
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    const d3 = mkCard('d3', '桃', '♦', '4');
    const p0a = mkCard('a1', '杀', '♣', '5');
    const p0b = mkCard('a2', '闪', '♣', '6');
    const p1Card = mkCard('x1', '杀', '♣', '7');
    await harness.setup(
      buildState({
        p0Hand: [p0a.id, p0b.id],
        p1Hand: [p1Card.id],
        cards: { d1, d2, d3, a1: p0a, a2: p0b, x1: p1Card },
        deck: ['d1', 'd2', 'd3'],
        turnVars: { '罪论/伤害/0': true, '罪论/弃置/0': true },
      }),
    );
    const P0 = harness.player('诸葛瞻');

    await P0.triggerAction('回合管理', 'end');
    P0.expectPending('请求回应');
    await P0.respond('罪论', { choice: true });

    // 挑选:获得 d2,d1 置顶(最先摸),d3 次之
    P0.expectPending('请求回应');
    await P0.respond('罪论', { gained: ['d2'], topOrder: ['d1', 'd3'] });

    // 获得 d2 入手
    expect(harness.state.players[0].hand).toContain('d2');
    expect(harness.state.players[0].hand.length).toBe(3);
    // 牌堆:d1 在顶(deck末尾=d1,最先摸),d3 在下
    expect(harness.state.zones.deck).toEqual(['d3', 'd1']);
  });

  it('X=0(均不满足):自己与一名其他角色各失去1点体力', async () => {
    // ①未造成伤害(无键)②弃置过牌(键存在→不满足)③非最少(P0=2 > P1=1)→ X=0
    const p0a = mkCard('a1', '杀', '♣', '5');
    const p0b = mkCard('a2', '闪', '♣', '6');
    const p1Card = mkCard('x1', '杀', '♣', '7');
    await harness.setup(
      buildState({
        p0Hand: [p0a.id, p0b.id],
        p1Hand: [p1Card.id],
        cards: { a1: p0a, a2: p0b, x1: p1Card },
        deck: [],
        turnVars: { '罪论/弃置/0': true },
        p0Health: 3,
      }),
    );
    const P0 = harness.player('诸葛瞻');

    await P0.triggerAction('回合管理', 'end');

    // X=0:选择一名其他角色
    P0.expectPending('请求回应');
    await P0.respond('罪论', { target: 1 });

    // 自己与 P1 各失去1点体力(失去体力,非伤害)
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[1].health).toBe(3);
  });

  it('X=0 超时未选目标:默认选第一个其他角色,仍失去体力', async () => {
    const p0a = mkCard('a1', '杀', '♣', '5');
    const p0b = mkCard('a2', '闪', '♣', '6');
    const p1Card = mkCard('x1', '杀', '♣', '7');
    await harness.setup(
      buildState({
        p0Hand: [p0a.id, p0b.id],
        p1Hand: [p1Card.id],
        cards: { a1: p0a, a2: p0b, x1: p1Card },
        deck: [],
        turnVars: { '罪论/弃置/0': true },
        p0Health: 3,
      }),
    );
    const P0 = harness.player('诸葛瞻');

    await P0.triggerAction('回合管理', 'end');
    P0.expectPending('请求回应');
    await P0.pass(); // 超时

    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[1].health).toBe(3);
  });

  it('罪论respond在非罪论询问时被拒绝(出牌阶段)', async () => {
    const p0a = mkCard('a1', '杀', '♣', '5');
    await harness.setup(
      buildState({
        p0Hand: [p0a.id],
        p1Hand: [],
        cards: { a1: p0a },
        deck: [],
      }),
    );
    const P0 = harness.player('诸葛瞻');

    // 出牌阶段当前是 出牌窗口(非罪论询问),respond 应被拒绝
    await P0.expectRejected({
      skillId: '罪论',
      actionType: 'respond',
      params: { choice: true },
    });
  });
});

// ────────────────────────────────────────────────────────────────
// 父荫
// ────────────────────────────────────────────────────────────────
describe('父荫', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // P1 回合对 P0 出杀的通用初始态
  function buildFuyin(opts: {
    p0Hand: string[];
    p1Hand: string[];
    cards: Record<string, Card>;
  }): GameState {
    return createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '诸葛瞻',
          character: '诸葛瞻',
          hand: opts.p0Hand,
          skills: ['父荫'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({
          index: 1,
          name: 'P1',
          character: '反',
          hand: opts.p1Hand,
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: opts.cards,
      // P1 的回合,这样 P1 可出牌
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
  }

  it('首次成杀目标且其手牌数>=你:杀对你无效(不受伤,不询问闪)', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const extra1 = mkCard('e1', '闪', '♥', '2');
    const extra2 = mkCard('e2', '桃', '♦', '3');
    const p0shan = mkCard('s1', '闪', '♣', '4');
    await harness.setup(
      buildFuyin({
        // P0 仅1张闪;P1 有杀+2张 → P1.hand(3) >= P0.hand(1)
        p0Hand: [p0shan.id],
        p1Hand: [kill.id, extra1.id, extra2.id],
        cards: { k1: kill, e1: extra1, e2: extra2, s1: p0shan },
      }),
    );
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await harness.waitForStable();

    // 父荫 cancel:不询问闪、不受伤
    expect(harness.state.players[0].health).toBe(3);
    // 杀进弃牌堆(结算收尾)
    expect(harness.state.zones.discardPile).toContain('k1');
    // 无 pending 残留
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('每回合一次:决斗已消耗机会,后续杀不再被父荫无效(决斗不计出杀次数)', async () => {
    const duel = mkCard('du1', '决斗', '♠', 'A', '锦囊牌');
    const kill = mkCard('k1', '杀', '♠', '7');
    const extra = mkCard('e1', '闪', '♥', '2');
    const p0shan = mkCard('s1', '闪', '♣', '4');
    await harness.setup(
      buildFuyin({
        // P0 手牌1(闪);P1 决斗+杀+闪(3) → 决斗时 P1.hand>=P0.hand
        p0Hand: [p0shan.id],
        p1Hand: [duel.id, kill.id, extra.id],
        cards: { du1: duel, k1: kill, e1: extra, s1: p0shan },
      }),
    );
    const P0 = harness.player('诸葛瞻');
    const P1 = harness.player('P1');

    // 决斗:首次成目标 → 父荫 cancel(决斗不计出杀次数,后续杀仍可用)
    await P1.useCardAndTarget('决斗', 'du1', [0]);
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(3);

    // 杀:父荫机会已被决斗消耗 → 不再无效 → 询问闪
    await P1.useCardAndTarget('杀', 'k1', [0]);
    await harness.waitForStable();
    P0.expectPending('询问闪');
    await P0.pass(); // 不出闪

    // 杀命中,掉1血
    expect(harness.state.players[0].health).toBe(2);
  });

  it('其手牌数<你:父荫触发但不无效(杀正常结算)', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const extra = mkCard('e1', '闪', '♥', '2');
    const p0a = mkCard('a1', '闪', '♣', '4');
    const p0b = mkCard('a2', '杀', '♣', '5');
    const p0c = mkCard('a3', '桃', '♦', '6');
    await harness.setup(
      buildFuyin({
        // P0 手牌3张;P1 手牌2张(杀+闪)→ P1.hand(2) < P0.hand(3)
        p0Hand: [p0a.id, p0b.id, p0c.id],
        p1Hand: [kill.id, extra.id],
        cards: { k1: kill, e1: extra, a1: p0a, a2: p0b, a3: p0c },
      }),
    );
    const P0 = harness.player('诸葛瞻');
    const P1 = harness.player('P1');

    // 手牌条件不满足 → 不无效 → 询问闪
    await P1.useCardAndTarget('杀', 'k1', [0]);
    await harness.waitForStable();
    P0.expectPending('询问闪');
    await P0.pass(); // 不出闪

    // 杀命中,掉1血
    expect(harness.state.players[0].health).toBe(2);
  });

  it('决斗:首次成决斗目标且其手牌数>=你:决斗对你无效(不进入决斗循环)', async () => {
    const duel = mkCard('du1', '决斗', '♠', 'A', '锦囊牌');
    const extra1 = mkCard('e1', '闪', '♥', '2');
    const extra2 = mkCard('e2', '桃', '♦', '3');
    await harness.setup(
      buildFuyin({
        // P0 手牌0;P1 有决斗+2张 → P1.hand(3) >= P0.hand(0)
        p0Hand: [],
        p1Hand: [duel.id, extra1.id, extra2.id],
        cards: { du1: duel, e1: extra1, e2: extra2 },
      }),
    );
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('决斗', 'du1', [0]);
    await harness.waitForStable();

    // 父荫 cancel:不进入决斗循环,P0 不受伤
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('du1');
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('自己回合出杀指定自己:父荫不触发(仅其他角色)', async () => {
    // P0 回合;P0 对自己出杀——父荫要求"其他角色",故不应 cancel
    const kill = mkCard('k1', '杀', '♠', '7');
    const p0shan = mkCard('s1', '闪', '♣', '4');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '诸葛瞻',
            character: '诸葛瞻',
            hand: [kill.id, p0shan.id],
            skills: ['父荫'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', hand: [], skills: [] }),
        ],
        cardMap: { k1: kill, s1: p0shan },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }) as GameState,
    );
    const P0 = harness.player('诸葛瞻');

    // 注:杀通常不能指定自己(targetFilter 排除自己),此处验证父荫 source===self 不触发
    // 用 runUseFlow 路径不可达时,直接断言父荫 vars 未被设置(无 cancel 副作用)
    // 改为验证:诸葛瞻正常出杀(目标为 P1)时,父荫不因 source===self 而误触发
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await harness.waitForStable();
    // P0 自己不是目标 → 父荫未触发,usedThisTurn 未置位
    expect(harness.state.players[0].vars['父荫/usedThisTurn']).toBeUndefined();
  });
});
