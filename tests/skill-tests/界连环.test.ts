// 界连环(界庞统·主动技)行为测试:
//   1. recycle:弃一张梅花手牌,摸一张牌
//   2. transform:将梅花手牌当铁索连环使用,可指定 3 名目标(界版 +1 目标)
//   3. 真实铁索连环牌:界庞统使用真实铁索连环牌,亦可指定 3 名目标(覆盖生效)
//   4. 边界:指定 4 名目标 → 拒绝(超过界版上限)
//   5. 非界庞统座次:仍走标版铁索连环.use,上限 2(覆盖仅作用于界庞统)
//
// OL 官方(hero):"你可以将一张梅花牌当【铁索连环】使用或重铸。你使用【铁索连环】可以多指定一个目标。"
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
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界连环', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── recycle:重铸梅花手牌 ─────────────────────────────

  it('recycle:弃一张梅花手牌 → 摸一张牌', async () => {
    const club = mkCard('c1', '杀', '♣', '5');
    const d1 = mkCard('d1', '闪', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            hand: [club.id],
            skills: ['界连环'],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: { c1: club, d1 },
        zones: { deck: ['d1'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const PT = harness.player('界庞统');

    await PT.triggerAction('界连环', 'recycle', { cardId: 'c1' });

    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[0].hand).toContain('d1');
  });

  // ─── transform + 铁索连环.use:界版 3 目标 ────────────────────

  it('transform+use:梅花牌当铁索连环,横置3名目标(界版+1)', async () => {
    const club = mkCard('c1', '杀', '♣', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            hand: [club.id],
            skills: ['界连环'],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
          mkPlayer({ index: 3, name: 'P3', character: '反', skills: [] }),
        ],
        cardMap: { c1: club },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const PT = harness.player('界庞统');

    // preceding=[界连环.transform] + 主 action=铁索连环.use,目标 3 名(超过标版上限 2)
    await PT.transformThenUse(
      '界连环',
      { cardId: 'c1' },
      '铁索连环',
      { cardId: 'c1#界连环', targets: [1, 2, 3] },
    );
    // 无懈可击:pass
    await PT.pass();
    await harness.waitForStable();

    // 三名目标均被横置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[3].marks.some((m) => m.id === 'chained')).toBe(true);
    // 影子卡入弃牌堆时还原为原卡(移动牌 atom 处理 shadowOf)
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── 真实铁索连环牌:界庞统用真实牌,亦可 3 目标 ─────────────

  it('use:真实铁索连环牌,界庞统可指定 3 名目标(覆盖铁索连环.use)', async () => {
    const chain = mkCard('chain1', '铁索连环', '♣', '3', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            hand: [chain.id],
            skills: ['界连环'],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
          mkPlayer({ index: 3, name: 'P3', character: '反', skills: [] }),
        ],
        cardMap: { chain1: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const PT = harness.player('界庞统');

    // 直接用真实铁索连环牌,3 目标(覆盖生效:其他座次上限是 2,界庞统是 3)
    await PT.triggerAction('铁索连环', 'use', { cardId: 'chain1', targets: [1, 2, 3] });
    await PT.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[3].marks.some((m) => m.id === 'chained')).toBe(true);
  });

  // ─── 边界:4 名目标 → 拒绝(超过界版上限 3) ─────────────────

  it('边界:指定 4 名目标 → 拒绝', async () => {
    const chain = mkCard('chain1', '铁索连环', '♣', '3', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界庞统',
            character: '界庞统',
            hand: [chain.id],
            skills: ['界连环'],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
          mkPlayer({ index: 3, name: 'P3', character: '反', skills: [] }),
          mkPlayer({ index: 4, name: 'P4', character: '反', skills: [] }),
        ],
        cardMap: { chain1: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const PT = harness.player('界庞统');

    // 4 名目标:validate 应拒绝(>3)
    await PT.triggerAction('铁索连环', 'use', { cardId: 'chain1', targets: [1, 2, 3, 4] });
    await harness.waitForStable();

    // 没人被横置(action 被拒)
    for (let i = 1; i <= 4; i++) {
      expect(harness.state.players[i].marks.some((m) => m.id === 'chained')).toBe(false);
    }
    // 牌仍在手牌
    expect(harness.state.players[0].hand).toContain('chain1');
  });

  // ─── 非界庞统座次:铁索连环.use 上限仍为 2(覆盖仅本座次) ────

  it('其他座次:铁索连环.use 上限仍为 2(标版未受影响)', async () => {
    const chain = mkCard('chain1', '铁索连环', '♣', '3', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          // 座次 0 是普通角色(无界连环),只有默认 铁索连环 card skill
          mkPlayer({
            index: 0,
            name: 'P0',
            character: '反',
            hand: [chain.id],
            skills: [],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
          mkPlayer({ index: 3, name: 'P3', character: '反', skills: [] }),
        ],
        cardMap: { chain1: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // 标版铁索连环.use:3 名目标 → 拒绝(标版上限 2)
    await P0.triggerAction('铁索连环', 'use', { cardId: 'chain1', targets: [1, 2, 3] });
    await harness.waitForStable();

    // 没人被横置
    for (let i = 1; i <= 3; i++) {
      expect(harness.state.players[i].marks.some((m) => m.id === 'chained')).toBe(false);
    }
    expect(harness.state.players[0].hand).toContain('chain1');
  });
});
