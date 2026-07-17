// tests/skill-tests/诈降.test.ts
// 诈降(界黄盖·锁定技,OL hero/307)测试:
//   当你失去1点体力后，你摸三张牌，若在你的出牌阶段，你本回合使用【杀】的限制次数+1、
//   使用红色【杀】无距离限制且不能被抵消。
//
// 关键区分(核心验证点):诈降挂在'失去体力' atom 的 after-hook,而非'造成伤害'。
//   - 失去体力(苦肉)→ 触发诈降(摸3 + 出牌阶段杀增益)
//   - 受到伤害(普攻/南蛮等)→ 不触发诈降
//
// 验证:
//   1. 正面·摸3张:失去体力后摸3张(无条件)
//   2. 正面·杀次数+1:苦肉后连出两杀均命中(quota base1+1=2,非无限)
//   3. 正面·红色杀无距离:红杀命中超距P3;黑杀指定超距P3被拒
//   4. 正面·红色杀不可抵消:红杀直接命中(P2无机会出闪);黑杀正常询问闪
//   5. 负面·未失去体力:杀受限(quota=1,第二杀被拒)
//   6. 负面·受到伤害不触发诈降
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import type { Card, Faction, Json } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  vars?: Record<string, Json>;
  faction?: Faction;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界黄盖',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界苦肉', '诈降'],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '吴',
  };
}

const DECK_IDS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
function seedDeckCards(state: ReturnType<typeof createGameState>) {
  for (const id of DECK_IDS) {
    state.cardMap[id] = makeCard(id, '杀', '♠');
  }
}

describe('诈降', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面·摸3张(无条件) ──────────────────────────────

  it('正面: 失去体力后摸3张牌(无条件,非出牌阶段也摸)', async () => {
    // 直接走 失去体力 atom,验证诈降 after-hook 摸3
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: [],
          skills: ['界苦肉', '诈降'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: [] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);

    expect(harness.state.players[0].hand.length).toBe(0);

    // 失去1点体力 → 诈降 after-hook 摸3张
    await applyAtom(harness.state, { type: '失去体力', target: 0, amount: 1 });

    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand).toEqual(['d6', 'd5', 'd4']);
  });

  it('正面: 非出牌阶段失去体力→摸3张但杀增益不激活', async () => {
    // 弃牌阶段失去体力:摸3(无条件),但 turn.vars['诈降/active'] 不设(非出牌阶段)
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: [],
          skills: ['界苦肉', '诈降'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: [] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);

    await applyAtom(harness.state, { type: '失去体力', target: 0, amount: 1 });

    // 摸3张(无条件)
    expect(harness.state.players[0].hand.length).toBe(3);
    // 杀增益未激活(非出牌阶段)
    expect(harness.state.turn.vars['诈降/active']).toBeUndefined();
  });

  // ─── 正面·杀次数+1 ───────────────────────────────────

  it('正面: 苦肉后连出两杀均命中(诈降激活,quota=base1+1=2)', async () => {
    const s1 = makeCard('s1', '杀', '♠');
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '杀', '♠'),
      s1,
    };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: ['c1', 's1'],
          skills: ['界苦肉', '诈降', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 苦肉(弃c1)→诈降激活(次数+1)
    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });
    expect(harness.state.turn.vars['诈降/active']).toBe(0);

    // 第一杀(s1,黑杀)→ P2 不闪 → 命中 4→3
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // 第二杀(d6,诈降摸到的黑杀)→ quota 允许(used=1 < max=2)→ 命中 3→2
    const secondSlash = harness.state.players[0].hand.find((id) => id !== 's1')!;
    await P1.useCardAndTarget('杀', secondSlash, [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 正面·红色杀无距离(黑色杀仍受限) ─────────────────

  it('正面: 红色杀无距离(命中超距P3);黑色杀指定超距P3被拒', async () => {
    // 4 人环形:P1(0)→P3(2) 座位距离 2,徒手范围 1 → 超距(3 人环全员距离 1 测不出)
    const redSlash = makeCard('r1', '杀', '♥');
    const blackSlash = makeCard('b1', '杀', '♠');
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '杀', '♣'),
      r1: redSlash,
      b1: blackSlash,
    };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: ['c1', 'r1', 'b1'],
          skills: ['界苦肉', '诈降', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: ['闪'] }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', health: 4, skills: ['闪'] }),
        makePlayer({ index: 3, name: 'P4', character: '孙权', health: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // 苦肉(弃c1)→诈降激活
    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });
    expect(harness.state.turn.vars['诈降/active']).toBe(0);

    // 红杀 r1 指定超距 P3(距离2 > 范围1)→ 诈降放行 → P3 不闪 → 命中
    await P1.useCardAndTarget('杀', 'r1', [2]);
    await P3.pass();
    expect(harness.state.players[2].health).toBe(3);

    // 黑杀 b1 指定超距 P3 → 被拒(红色专属,黑杀走正常距离)
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'b1', targets: [2] },
    });
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 正面·红色杀不可抵消 ─────────────────────────────

  it('正面: 红色杀不可被闪(直接命中,P2无机会出闪)', async () => {
    const redSlash = makeCard('r1', '杀', '♦');
    const dodge = makeCard('dodge', '闪', '♣');
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '杀', '♣'),
      r1: redSlash,
      dodge,
    };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: ['c1', 'r1'],
          skills: ['界苦肉', '诈降', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, hand: ['dodge'], skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });
    expect(harness.state.turn.vars['诈降/active']).toBe(0);

    // 红杀 r1 → 跳过询问闪(不可抵消)→ P2 直接受伤,无 pending
    await P1.useCardAndTarget('杀', 'r1', [1]);
    expect(harness.state.players[1].health).toBe(3);
    // P2 的闪仍在手(没机会出)
    expect(harness.state.players[1].hand).toContain('dodge');
    // 无 pending(红杀直接结算完成)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('对照: 黑色杀正常询问闪(P2可出闪抵消)', async () => {
    const blackSlash = makeCard('b1', '杀', '♠');
    const dodge = makeCard('dodge', '闪', '♣');
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '杀', '♣'),
      b1: blackSlash,
      dodge,
    };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: ['c1', 'b1'],
          skills: ['界苦肉', '诈降', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, hand: ['dodge'], skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });

    // 黑杀 b1 → 正常询问闪 → P2 出闪抵消 → 不受伤
    await P1.useCardAndTarget('杀', 'b1', [1]);
    await P2.respond('闪', { cardId: 'dodge' });
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 负面·未失去体力时杀受限 ─────────────────────────

  it('负面: 未发动苦肉(未失去体力),第一杀后第二杀被拒(quota=1)', async () => {
    const s1 = makeCard('s1', '杀', '♠');
    const s2 = makeCard('s2', '杀', '♠');
    const cardMap: Record<string, Card> = { s1, s2 };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: ['s1', 's2'],
          skills: ['界苦肉', '诈降', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    expect(harness.state.turn.vars['诈降/active']).toBeUndefined();

    // 第一杀 → 命中(quota 1→0)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // 第二杀 → 出杀次数已用尽,被拒
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 's2', targets: [1] },
    });
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 负面·受到伤害不触发诈降 ─────────────────────────

  it('负面: P1受到伤害(非失去体力)后,诈降未激活', async () => {
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: [],
          skills: ['界苦肉', '诈降', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: [] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);

    await applyAtom(harness.state, { type: '造成伤害', target: 0, amount: 1, source: 1 });
    expect(harness.state.players[0].health).toBe(3);

    // 诈降挂在'失去体力',不应被'造成伤害'触发
    expect(harness.state.turn.vars['诈降/active']).toBeUndefined();
  });
});
