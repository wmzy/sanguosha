// 界涅槃(界庞统·限定技)行为测试:
//   1. 濒死发动界涅槃:弃所有牌+判定区、解除连环、摸3张、回复至3体力,然后获得八阵/火计/看破之一
//   2. 三选一:选择火计 → 获得火计技能(三选一分支覆盖)
//   3. 不发动界涅槃 → 进入求桃流程,无人救则死亡
//   4. 限定技:用过一次后,再次濒死不再触发
//
// OL 官方(hero):"限定技,当你处于濒死状态时,你可以:弃置所有牌,复原你的武将牌,摸三张牌,
//   回复至3点体力,然后获得八阵/火计/看破中的一个。"
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
  rank = 'A',
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
  marks?: GameState['players'][number]['marks'];
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界涅槃', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('濒死发动界涅槃:弃所有牌、解除连环、摸3张、回复至3体力,然后获得八阵', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    const hand1 = mkCard('pt1', '闪', '♣', '2');
    const hand2 = mkCard('pt2', '杀', '♣', '3');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            hand: [hand1.id, hand2.id],
            skills: ['界涅槃', '闪'],
            health: 1, // 一击即濒死
            maxHealth: 3,
            marks: [{ id: 'chained', scope: 0 }], // 处于连环状态
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '反',
            hand: [slash.id],
            skills: ['杀'],
          }),
        ],
        cardMap: { s1: slash, pt1: hand1, pt2: hand2 },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const PT = harness.player('界庞统');

    // P1 杀 庞统
    await P1.useCardAndTarget('杀', 's1', [0]);
    // 庞统被询问闪 → 不出闪(pass)→ 受伤濒死
    await PT.pass();
    // 此时进入濒死流程 → 界涅槃询问发动(请求回应 pending)
    await harness.waitForStable();
    // 庞统 confirm 发动界涅槃
    await PT.respond('界涅槃', { choice: true });
    await harness.waitForStable();

    // 界涅槃主流程跑完后,询问三选一(请求回应 pending,requestType='界涅槃/选技能')
    await PT.respond('界涅槃', { skill: '八阵' });
    await harness.waitForStable();

    // 庞统存活,回复至3点体力
    expect(harness.state.players[0].alive).toBe(true);
    expect(harness.state.players[0].health).toBe(3);
    // 原有2张手牌被弃(进弃牌堆)
    expect(harness.state.players[0].hand).not.toContain('pt1');
    expect(harness.state.players[0].hand).not.toContain('pt2');
    expect(harness.state.zones.discardPile).toContain('pt1');
    expect(harness.state.zones.discardPile).toContain('pt2');
    // 摸了3张:手牌数=3
    expect(harness.state.players[0].hand.length).toBe(3);
    // 解除连环:marks 不再含 chained
    expect(harness.state.players[0].marks.some((m) => m.id === 'chained')).toBe(false);
    // 限定技标记已设
    expect(harness.state.players[0].vars['界涅槃/used']).toBe(true);
    // 获得八阵技能(三选一)
    expect(harness.state.players[0].skills).toContain('八阵');
    void PT;
  });

  it('三选一:选择火计 → 获得火计技能', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            skills: ['界涅槃'],
            health: 1,
            maxHealth: 3,
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '反',
            hand: [slash.id],
            skills: ['杀'],
          }),
        ],
        cardMap: { s1: slash },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const PT = harness.player('界庞统');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await PT.pass();
    await harness.waitForStable();
    await PT.respond('界涅槃', { choice: true });
    await harness.waitForStable();
    // 三选一:选火计
    await PT.respond('界涅槃', { skill: '火计' });
    await harness.waitForStable();

    expect(harness.state.players[0].skills).toContain('火计');
    expect(harness.state.players[0].skills).not.toContain('八阵');
    expect(harness.state.players[0].skills).not.toContain('看破');
  });

  it('三选一:选择看破 → 获得看破技能', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            skills: ['界涅槃'],
            health: 1,
            maxHealth: 3,
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '反',
            hand: [slash.id],
            skills: ['杀'],
          }),
        ],
        cardMap: { s1: slash },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const PT = harness.player('界庞统');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await PT.pass();
    await harness.waitForStable();
    await PT.respond('界涅槃', { choice: true });
    await harness.waitForStable();
    await PT.respond('界涅槃', { skill: '看破' });
    await harness.waitForStable();

    expect(harness.state.players[0].skills).toContain('看破');
  });

  it('不发动界涅槃 → 求桃无人救 → 死亡', async () => {
    const slash = mkCard('s2', '杀', '♠', '8');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            hand: [],
            skills: ['界涅槃'],
            health: 1,
            maxHealth: 3,
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '反',
            hand: [slash.id],
            skills: ['杀'],
          }),
        ],
        cardMap: { s2: slash },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const PT = harness.player('界庞统');

    await P1.useCardAndTarget('杀', 's2', [0]);
    await PT.pass(); // 不出闪
    await harness.waitForStable();
    // 界涅槃询问 → 不发动
    await PT.respond('界涅槃', { choice: false });
    await harness.waitForStable();
    // 求桃:庞统自己没桃 → pass;P1 没桃 → pass
    while (harness.state.pendingSlots.size > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const target = (slot.atom as { target?: number }).target;
      await harness.player(target ?? 0).pass();
      await harness.waitForStable();
    }

    // 庞统死亡
    expect(harness.state.players[0].alive).toBe(false);
    // 界涅槃未使用
    expect(harness.state.players[0].vars['界涅槃/used']).toBeFalsy();
    void PT;
  });

  it('限定技:用过一次后再次濒死不再触发界涅槃', async () => {
    const slash1 = mkCard('s3', '杀', '♠', '4');
    const slash2 = mkCard('s4', '杀', '♠', '5');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            hand: [],
            skills: ['界涅槃'],
            health: 1,
            maxHealth: 1, // 便于二次濒死
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '反',
            hand: [slash1.id, slash2.id],
            skills: ['杀', '诸葛连弩'], // 连弩:无限出杀
          }),
        ],
        cardMap: { s3: slash1, s4: slash2 },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const PT = harness.player('界庞统');

    // 第一次濒死:发动界涅槃(回复至 maxHealth=1)
    await P1.useCardAndTarget('杀', 's3', [0]);
    await PT.pass(); // 不出闪
    await harness.waitForStable();
    await PT.respond('界涅槃', { choice: true });
    await harness.waitForStable();
    await PT.respond('界涅槃', { skill: '看破' });
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(1);
    expect(harness.state.players[0].vars['界涅槃/used']).toBe(true);
    expect(harness.state.players[0].skills).toContain('看破');

    // 第二次杀到濒死(连弩允许多次出杀)
    await P1.useCardAndTarget('杀', 's4', [0]);
    await PT.pass();
    await harness.waitForStable();

    // 界涅槃不应再触发(used 已设):无 界涅槃/confirm 的请求回应 pending
    const requestTypes = [...harness.state.pendingSlots.values()].map(
      (s) => (s.atom as Record<string, unknown>).requestType,
    );
    expect(requestTypes).not.toContain('界涅槃/confirm');

    // 求桃:庞统无桃→死亡。pass 掉所有求桃 pending
    while (harness.state.pendingSlots.size > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const target = (slot.atom as { target?: number }).target ?? 0;
      await harness.player(target).pass();
      await harness.waitForStable();
    }
    // 庞统死亡(界涅槃未再次发动)
    expect(harness.state.players[0].alive).toBe(false);
    void PT;
  });
});
