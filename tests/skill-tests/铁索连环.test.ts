// 铁索连环(普通锦囊)行为测试:
//   重点验证【use】横置/重置、【recast】重铸、【传导】属性伤害。
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
  damageType?: '火焰' | '雷电',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  const card: Card = { id, name, suit, color, rank, type };
  if (damageType) card.damageType = damageType;
  return card;
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  marks?: Array<{ id: string; scope: number }>;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
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

describe('铁索连环', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── use:横置/重置 ─────────────────────────────

  it('use:横置两名角色', async () => {
    const chain = mkCard('chain1', '铁索连环', '♣', '3', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chain1'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
        ],
        cardMap: { chain1: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.triggerAction('铁索连环', 'use', { cardId: 'chain1', targets: [1, 2] });
    // 无懈可击:pass(超时 = 无人打无懈)
    await P0.pass();

    // P1 和 P2 都被横置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);
    // 铁索连环进弃牌堆
    expect(harness.state.zones.discardPile).toContain('chain1');
  });

  it('use:重置已横置角色(toggle)', async () => {
    const chain = mkCard('chain2', '铁索连环', '♠', '5', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chain2'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', health: 3, marks: [{ id: 'chained', scope: 1 }], skills: [] }),
        ],
        cardMap: { chain2: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // 确认 P1 初始已横置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);

    await P0.triggerAction('铁索连环', 'use', { cardId: 'chain2', targets: [1] });
    await P0.pass(); // 无懈可击 pass

    // P1 被重置(不再横置)
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(false);
  });

  it('use:目标数不合法拒绝', async () => {
    const chain = mkCard('chain3', '铁索连环', '♣', 'K', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chain3'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
        ],
        cardMap: { chain3: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // 无目标
    await P0.expectRejected({ skillId: '铁索连环', actionType: 'use', params: { cardId: 'chain3', targets: [] } });
    // 3 个目标(上限 2)
    await P0.expectRejected({ skillId: '铁索连环', actionType: 'use', params: { cardId: 'chain3', targets: [1, 2, 0] } });
  });

  // ─── recast:重铸 ─────────────────────────────

  it('recast:弃此牌摸一张', async () => {
    const chain = mkCard('chainR', '铁索连环', '♦', '7', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainR'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: { chainR: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');
    const deckBefore = harness.state.zones.deck.length;
    expect(harness.state.players[0].hand).toContain('chainR');

    await P0.triggerAction('铁索连环', 'recast', { cardId: 'chainR' });

    // 牌进弃牌堆
    expect(harness.state.players[0].hand).not.toContain('chainR');
    expect(harness.state.zones.discardPile).toContain('chainR');
    // 摸一张:手牌数 1(原 1 弃 0 摸 1)
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.zones.deck.length).toBe(deckBefore - 1);
  });

  // ─── 连环传导 ─────────────────────────────

  /** 辅助:设 P1+P2 横置后,用指定杀攻击 P1,验证传导行为 */
  async function runConductionTest(
    slashCard: Card,
    expectConduction: boolean,
  ): Promise<void> {
    const chain = mkCard('chainC', '铁索连环', '♠', '4', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainC', slashCard.id], skills: ['铁索连环', '杀'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', health: 3, maxHealth: 3, skills: ['闪'] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', health: 3, maxHealth: 3, skills: [] }),
        ],
        cardMap: { chainC: chain, [slashCard.id]: slashCard },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // Step 1: 铁索连环横置 P1 P2
    await P0.triggerAction('铁索连环', 'use', { cardId: 'chainC', targets: [1, 2] });
    await P0.pass(); // 无懈可击 pass

    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);

    const p1HealthBefore = harness.state.players[1].health;
    const p2HealthBefore = harness.state.players[2].health;

    // Step 2: 杀 P1
    await P0.useCardAndTarget('杀', slashCard.id, [1]);
    // P1 不出闪
    await P1.pass();

    if (expectConduction) {
      // P1 受到 1 点属性伤害
      expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
      // P2 受到传导伤害 1 点
      expect(harness.state.players[2].health).toBe(p2HealthBefore - 1);
      // 所有横置角色被重置
      expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(false);
      expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(false);
    } else {
      // 普通伤害:只有 P1 掉血
      expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
      expect(harness.state.players[2].health).toBe(p2HealthBefore);
    }
  }

  it('火焰伤害传导给所有横置角色', async () => {
    const fireSlash = mkCard('fire1', '杀', '♥', 'A', '基本牌', '火焰');
    await runConductionTest(fireSlash, true);
  });

  it('雷电伤害传导', async () => {
    const lightningSlash = mkCard('light1', '杀', '♠', '5', '基本牌', '雷电');
    await runConductionTest(lightningSlash, true);
  });

  it('普通伤害不传导', async () => {
    const normalSlash = mkCard('plain1', '杀', '♠', '3', '基本牌');
    await runConductionTest(normalSlash, false);
  });

  it('未横置不传导', async () => {
    const chain = mkCard('chainU', '铁索连环', '♣', '8', '锦囊牌');
    // 预设 P1 横置, P2 不横置
    const fireSlash = mkCard('fireU', '杀', '♥', '2', '基本牌', '火焰');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainU', fireSlash.id], skills: ['铁索连环', '杀'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', health: 3, maxHealth: 3, marks: [{ id: 'chained', scope: 1 }], skills: ['闪'] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', health: 3, maxHealth: 3, skills: [] }),
        ],
        cardMap: { chainU: chain, [fireSlash.id]: fireSlash },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 确认只有 P1 横置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(false);

    const p2HealthBefore = harness.state.players[2].health;

    // 火杀 P1
    await P0.useCardAndTarget('杀', fireSlash.id, [1]);
    await P1.pass();

    // P1 掉血, P2 不掉血(未横置)
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.players[2].health).toBe(p2HealthBefore);
    // P1 被重置(传导到 0 个其他角色后仍重置)
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(false);
  });
});