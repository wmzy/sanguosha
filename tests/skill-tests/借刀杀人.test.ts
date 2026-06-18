// tests/skill-tests/借刀杀人.test.ts
// 借刀杀人(普通锦囊):
//   出牌阶段对装备区有武器的 1 名其他角色(A)使用。
//   A 须选择:对使用者指定的另一名角色 B 使用 1 张杀,或交出武器。
//
// 当前实现使用 `confirm` 提示让 A 选择"出杀/不出",但随后检查 `state.zones.processing`
// 中是否有杀牌 → 实际 `confirm(true)` 不会把杀牌放入处理区(只会调用 confirm action)。
// 这意味着 A 无法通过 UI 真正"出杀",只能超时(选择不出)→ 发起者获得 A 的武器。
// 正面"出杀"路径会丢失,A 永远拿到的是"不出"分支。
//
// 覆盖:
//   1. A 不出杀(超时)→ 发起者获得 A 的武器
//   2. validate 拒绝(negative):A 无武器 / killTarget=A / killTarget=发起者 / killTarget 不存在 / 非自己回合
// BUG: "A 出杀"路径无法在当前实现下被测(confirm prompt 与 processing 检查不匹配)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  alive?: boolean;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['借刀杀人', '杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, rank, type };
}

function buildState(opts?: {
  p1Hand?: string[];
  p1Skills?: string[];
  p2Hand?: string[];
  p2Skills?: string[];
  p2Equipment?: Record<string, string>;
  p3Hand?: string[];
  p3Skills?: string[];
  extraCards?: Record<string, Card>;
  playerCount?: number;
}): GameState {
  const jd = makeCard('jd1', '借刀杀人', '♠', 'A');
  const cards: Record<string, Card> = { jd1: jd, ...(opts?.extraCards ?? {}) };
  const n = opts?.playerCount ?? 3;
  const players = [
    makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['jd1'], skills: opts?.p1Skills ?? ['借刀杀人', '杀'] }),
    makePlayer({
      index: 1,
      name: 'P2',
      hand: opts?.p2Hand ?? [],
      equipment: opts?.p2Equipment ?? {},
      skills: opts?.p2Skills ?? ['杀'],
    }),
  ];
  for (let i = 2; i < n; i++) {
    players.push(makePlayer({ index: i, name: `P${i + 1}`, hand: opts?.p3Hand, skills: opts?.p3Skills }));
  }
  return createGameState({
    players,
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('借刀杀人', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. A 不出杀(超时 pass)→ 发起者获得 A 的武器
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2(有武器)借刀杀人,killTarget=P3,P2 不出杀 → P1 获得 P2 的武器', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const state = buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 起手 1 (jd1),用出后从 P2 拿 wp1,手牌数仍为 1
    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 消耗无懈窗口

    // P2 被询问出杀/不出 → pass() 触发 onTimeout(不出)
    await P2.pass();

    // P2 的武器被卸下
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    // P1 拿到 P2 的武器
    expect(harness.state.players[0].hand).toContain('wp1');
    expect(harness.state.players[0].hand.length).toBe(1);
    // 借刀杀人牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
    expect(harness.state.zones.processing).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // A 出杀:选一张杀牌通过 杀.respond 移入处理区,killTarget 扣血
  // ─────────────────────────────────────────────────────────────
  it('P2 出杀(有杀在手)→ P3 扣 1 血', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon, p2s: s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    const p3HealthBefore = harness.state.players[2].health;

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口
    // P2 选一张杀打出(杀.respond 将杀移入处理区)
    await P2.respond('杀', { cardId: 'p2s' });
    // 现在借刀杀人继续结算:对 killTarget=P3 询问闪
    // P3 无闪(pass)
    await P3.pass();

    // P3 扣 1 血
    expect(harness.state.players[2].health).toBe(p3HealthBefore - 1);
    // P2 的杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p2s');
    // P2 的武器未丢失
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
    // 借刀杀人进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
    expect(harness.state.zones.processing).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. validate 拒绝:A 无武器
  // ─────────────────────────────────────────────────────────────
  it('A(P2)无武器 → 借刀杀人被拒绝(targetHasWeapon=false)', async () => {
    await harness.setup(buildState({
      p2Equipment: {}, // P2 没有武器
    }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:killTarget = A
  // ─────────────────────────────────────────────────────────────
  it('killTarget = A(P2) → 被拒绝(killTargetNotTarget=false)', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    await harness.setup(buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:killTarget = 发起者
  // ─────────────────────────────────────────────────────────────
  it('killTarget = 发起者(P1) → 被拒绝(killTargetNotOwner=false)', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    await harness.setup(buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 0 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:A 是自己
  // ─────────────────────────────────────────────────────────────
  it('target = 自己 → 被拒绝(notSelf)', async () => {
    // P1 自己借刀
    await harness.setup(buildState({ p2Equipment: {} }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 0, killTarget: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合 → 被拒绝', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const state = buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. validate 拒绝:killTarget 不存在
  // ─────────────────────────────────────────────────────────────
  it('killTarget 不存在(idx 99)→ 被拒绝(killTargetAlive=false)', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    await harness.setup(buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 99 },
    });
  });
});
