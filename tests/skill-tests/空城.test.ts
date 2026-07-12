// tests/skill-tests/空城.test.ts
// 空城(诸葛亮·锁定技)测试:若你没有手牌,你不是【杀】和【决斗】的合法目标。
//
// 验证:
//   1. 正面:无手牌时被杀 → 成为目标被 cancel → 不受伤害
//   2. 正面:无手牌时被决斗 → 成为目标被 cancel → 不结算,不受伤害
//   3. 负面:有手牌时空城不生效 → 被杀正常结算扣血
//   4. 正面:无手牌被杀后,杀牌正常进弃牌堆(结算流程仍走完收尾)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '诸葛亮',
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

describe('空城', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('正面:无手牌被杀 → 不受伤害', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
          character: '张飞',
          health: 4,
          maxHealth: 4,
        }),
        // P2 = 诸葛亮,空城,无手牌
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['空城'] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const hpBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await harness.waitForStable();
    harness.processAllEvents();

    // 空城生效:成为目标被 cancel → 无询问闪、无伤害
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(hpBefore);
    // 杀牌正常进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  it('正面:无手牌被决斗 → 不结算,不受伤害', async () => {
    const duel = makeCard('d1', '决斗', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['d1'],
          skills: ['杀', '决斗'],
          character: '张飞',
          health: 4,
          maxHealth: 4,
        }),
        // P2 = 诸葛亮,空城,无手牌
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['空城'] }),
      ],
      cardMap: { d1: duel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const hpBefore = harness.state.players[1].health;

    await P1.triggerAction('决斗', 'use', { cardId: 'd1', targets: [1] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 空城生效:成为目标被 cancel → 跳过无懈可击与决斗循环,无伤害
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(hpBefore);
    // 决斗牌正常进弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  it('负面:有手牌时空城不生效 → 被杀正常扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
          character: '张飞',
          health: 4,
          maxHealth: 4,
        }),
        // P2 = 诸葛亮,空城,但有手牌(一张闪)→ 空城不生效
        makePlayer({ index: 1, name: 'P2', hand: ['c2'], skills: ['空城', '闪'] }),
      ],
      cardMap: { k1: kill, c2: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const hpBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await harness.waitForStable();
    harness.processAllEvents();
    // 有手牌 → 空城不生效 → 询问闪
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪
    await harness.waitForStable();
    harness.processAllEvents();

    // 正常扣 1 血
    expect(harness.state.players[1].health).toBe(hpBefore - 1);
  });

  it('正面:无手牌被杀时,目标结算被跳过(不出现询问闪)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
          character: '张飞',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['空城'] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await harness.waitForStable();
    harness.processAllEvents();

    // 成为目标被 cancel(cancel 的 atom 记为 atomCancelled notify,而非 atom 事件)
    // 验证:有 成为目标 的 cancel 事件,但无 询问闪 / 造成伤害
    const history = harness.state.atomHistory as Array<{
      kind: string;
      atom?: { type: string };
      eventType?: string;
      data?: { atomType?: string };
    }>;
    const cancelledTypes = history
      .filter((e) => e.kind === 'notify' && e.eventType === 'atomCancelled')
      .map((e) => e.data?.atomType ?? '');
    expect(cancelledTypes).toContain('成为目标');
    const atoms = history
      .filter((e) => e.kind === 'atom')
      .map((e) => e.atom?.type ?? '');
    expect(atoms).not.toContain('询问闪');
    expect(atoms).not.toContain('造成伤害');
    expect(harness.state.players[1].health).toBe(3);
  });
});
