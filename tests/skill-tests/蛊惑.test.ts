// 蛊惑(于吉·主动技)行为测试:
//   1. 无人质疑 → 声明杀生效(目标受伤,扣牌入弃牌堆)
//   2. 质疑真牌 → 质疑者失1体力,声明杀仍生效(目标受伤)
//   3. 质疑假牌 → 质疑者获得此牌,作废(无伤害,扣牌归质疑者)
//   4. 声明桃·无人质疑 → 回复1体力
//   5. 限一次:同回合再次蛊惑被拒
//   6. 非法声明/非出牌阶段/无手牌 被拒
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = '7',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): GameState['players'][number] {
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

/** 当前唯一阻塞型 pending 的 target(请求回应/询问闪 等) */
function pendingTarget(state: GameState): number | undefined {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return undefined;
  const atom = slots[0].atom as { target?: number; player?: number };
  return atom.target ?? atom.player;
}

/** 当前 pending 的 atom type */
function pendingType(state: GameState): string | undefined {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return undefined;
  return (slots[0].atom as { type: string }).type;
}

function baseState(opts: {
  yujiHand: string[];
  p1Hand?: string[];
  p2Hand?: string[];
  yujiHealth?: number;
  yujiMax?: number;
  cardMap: Record<string, Card>;
}): GameState {
  return createGameState({
    players: [
      mkPlayer({
        index: 0,
        name: '于吉',
        character: '于吉',
        skills: ['蛊惑'],
        hand: opts.yujiHand,
        health: opts.yujiHealth ?? 3,
        maxHealth: opts.yujiMax ?? 3,
      }),
      mkPlayer({ index: 1, name: 'P1', character: '反', hand: opts.p1Hand ?? [], skills: ['闪'] }),
      mkPlayer({ index: 2, name: 'P2', character: '反', hand: opts.p2Hand ?? [], skills: ['闪'] }),
    ],
    cardMap: opts.cardMap,
    zones: { deck: [], discardPile: [], processing: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('蛊惑', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('无人质疑 → 声明杀生效(目标受伤,扣牌入弃牌堆)', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7');
    await harness.setup(
      baseState({ yujiHand: ['s1'], cardMap: { s1 } }),
    );
    const YJ = harness.player('于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 于吉扣置真杀,声明为杀,目标 P1
    await YJ.triggerAction('蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 1 });
    expect(pendingType(harness.state)).toBe('请求回应');
    expect(pendingTarget(harness.state)).toBe(1); // 先问 P1

    await P1.pass(); // P1 不质疑
    expect(pendingType(harness.state)).toBe('请求回应');
    expect(pendingTarget(harness.state)).toBe(2); // 再问 P2

    await P2.pass(); // P2 不质疑 → 无人质疑 → 杀生效
    expect(pendingType(harness.state)).toBe('询问闪');
    expect(pendingTarget(harness.state)).toBe(1); // 目标 P1 被询问闪

    await P1.pass(); // P1 不闪 → 受伤
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // P1 受 1 点伤害
    expect(harness.state.players[2].health).toBe(4); // P2 未受伤
    expect(harness.state.zones.discardPile).toContain('s1'); // 扣牌已使用入弃牌堆
    expect(harness.state.players[0].hand).not.toContain('s1');
  });

  it('质疑真牌 → 质疑者失1体力,声明杀仍生效', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7'); // 真杀
    await harness.setup(baseState({ yujiHand: ['s1'], cardMap: { s1 } }));
    const YJ = harness.player('于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 于吉扣置真杀,声明杀,目标 P2
    await YJ.triggerAction('蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 2 });
    expect(pendingTarget(harness.state)).toBe(1); // 先问 P1

    await P1.respond('蛊惑', {}); // P1 质疑 → 翻牌(真杀)
    // 真: P1 失1体力,然后杀生效 → 询问 P2 闪
    expect(pendingType(harness.state)).toBe('询问闪');
    expect(pendingTarget(harness.state)).toBe(2);

    await P2.pass(); // P2 不闪 → 受伤
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // P1(质疑者)失1体力
    expect(harness.state.players[2].health).toBe(3); // P2(目标)受杀伤害
    expect(harness.state.zones.discardPile).toContain('s1'); // 真牌按声明使用,入弃牌堆
  });

  it('质疑假牌 → 质疑者获得此牌,作废(无伤害)', async () => {
    const s1 = mkCard('s1', '闪', '♥', '7'); // 假牌(非杀)
    await harness.setup(baseState({ yujiHand: ['s1'], cardMap: { s1 } }));
    const YJ = harness.player('于吉');
    const P1 = harness.player('P1');

    // 于吉扣置闪,声明为杀,目标 P2(虚张声势)
    await YJ.triggerAction('蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 2 });
    expect(pendingTarget(harness.state)).toBe(1);

    await P1.respond('蛊惑', {}); // P1 质疑 → 翻牌(闪,假)
    await harness.waitForStable();

    // 假: P1 获得此牌,作废(无伤害)
    expect(harness.state.players[1].health).toBe(4); // 质疑者不失体力
    expect(harness.state.players[2].health).toBe(4); // 目标未受伤(作废)
    expect(harness.state.players[1].hand).toContain('s1'); // 质疑者获得扣牌
    expect(harness.state.zones.discardPile).not.toContain('s1'); // 扣牌被取走
    expect(harness.state.players[0].hand).not.toContain('s1'); // 于吉失去此牌
  });

  it('声明桃·无人质疑 → 回复1体力', async () => {
    const t1 = mkCard('t1', '桃', '♥', '7');
    await harness.setup(
      baseState({ yujiHand: ['t1'], yujiHealth: 2, yujiMax: 3, cardMap: { t1 } }),
    );
    const YJ = harness.player('于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await YJ.triggerAction('蛊惑', 'use', { cardId: 't1', declaredName: '桃' });
    await P1.pass();
    await P2.pass();
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 回复1体力至上限
    expect(harness.state.zones.discardPile).toContain('t1');
  });

  it('限一次:同回合再次蛊惑被拒', async () => {
    const t1 = mkCard('t1', '桃', '♥', '7');
    const t2 = mkCard('t2', '桃', '♥', '8');
    await harness.setup(
      baseState({ yujiHand: ['t1', 't2'], yujiHealth: 2, yujiMax: 3, cardMap: { t1, t2 } }),
    );
    const YJ = harness.player('于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一次蛊惑(声明桃,无人质疑,回复)
    await YJ.triggerAction('蛊惑', 'use', { cardId: 't1', declaredName: '桃' });
    await P1.pass();
    await P2.pass();
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(3);

    // 第二次蛊惑应被拒(本回合已用过)
    await YJ.expectRejected({
      skillId: '蛊惑',
      actionType: 'use',
      params: { cardId: 't2', declaredName: '桃' },
    });
  });

  it('非法声明/非出牌阶段/无目标 被拒', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7');
    await harness.setup(baseState({ yujiHand: ['s1'], cardMap: { s1 } }));
    const YJ = harness.player('于吉');

    // 声明非基本牌被拒
    await YJ.expectRejected({
      skillId: '蛊惑',
      actionType: 'use',
      params: { cardId: 's1', declaredName: '决斗' },
    });
    // 声明杀但无目标被拒
    await YJ.expectRejected({
      skillId: '蛊惑',
      actionType: 'use',
      params: { cardId: 's1', declaredName: '杀' },
    });
    // 声明杀但目标是自己被拒(不在攻击范围)
    await YJ.expectRejected({
      skillId: '蛊惑',
      actionType: 'use',
      params: { cardId: 's1', declaredName: '杀', target: 0 },
    });
  });

  it('声明酒·无人质疑 → 获得酒增伤标记', async () => {
    const j1 = mkCard('j1', '酒', '♣', '7');
    await harness.setup(baseState({ yujiHand: ['j1'], cardMap: { j1 } }));
    const YJ = harness.player('于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await YJ.triggerAction('蛊惑', 'use', { cardId: 'j1', declaredName: '酒' });
    await P1.pass();
    await P2.pass();
    await harness.waitForStable();

    // 酒增伤标记(下张杀+1)
    const marks = harness.state.players[0].marks;
    expect(marks.some((m) => m.id === '酒/nextKillDamageBonus')).toBe(true);
    expect(harness.state.zones.discardPile).toContain('j1');
  });
});
