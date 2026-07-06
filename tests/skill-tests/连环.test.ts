// 连环(庞统·主动技)行为测试:
//   重点验证【重铸】:弃一张梅花手牌,摸一张牌。
//   (转化为铁索连环【使用】部分待铁索连环技能实现,此处不测)
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
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 3,
    maxHealth: opts.health ?? 3,
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

describe('连环·重铸', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('重铸梅花手牌:弃该牌并摸一张', async () => {
    const club = mkCard('c1', '杀', '♣', '5'); // 梅花杀
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '庞统',
            character: '庞统',
            hand: [club.id],
            skills: ['连环'],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: { c1: club },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const PT = harness.player('庞统');

    expect(harness.state.players[0].hand).toContain('c1');
    const deckBefore = harness.state.zones.deck.length;

    await PT.triggerAction('连环', 'recycle', { cardId: 'c1' });

    // 梅花牌被弃(进弃牌堆)
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c1');
    // 摸了一张:手牌数 1(原本1张弃掉后0,摸1张回到1)
    expect(harness.state.players[0].hand.length).toBe(1);
    // 牌堆少了一张
    expect(harness.state.zones.deck.length).toBe(deckBefore - 1);
  });

  it('非梅花手牌不可重铸:validate 拒绝', async () => {
    const heart = mkCard('h1', '杀', '♥', '5'); // 红桃杀(非梅花)
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '庞统',
            character: '庞统',
            hand: [heart.id],
            skills: ['连环'],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: { h1: heart },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const PT = harness.player('庞统');

    // 非梅花牌应被拒绝
    await PT.expectRejected({ skillId: '连环', actionType: 'recycle', params: { cardId: 'h1' } });
    // 牌仍在手中
    expect(harness.state.players[0].hand).toContain('h1');
  });

  it('非自己回合不可重铸:validate 拒绝', async () => {
    const club = mkCard('c2', '杀', '♣', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '庞统',
            character: '庞统',
            hand: [club.id],
            skills: ['连环'],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: { c2: club },
        currentPlayerIndex: 1, // P1 回合,非庞统
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const PT = harness.player('庞统');

    await PT.expectRejected({ skillId: '连环', actionType: 'recycle', params: { cardId: 'c2' } });
    expect(harness.state.players[0].hand).toContain('c2');
  });
});
