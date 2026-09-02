// 恃才(许攸·群·被动技)技能测试:
//   当你每回合首次使用一种类型的牌后,你可以将之置于牌堆顶,然后摸一张牌。
//
// 来源:2026-08-26 bug 修复会话新增(此前无任何专属测试)。
//   回归核心:转化牌(武圣影子卡)入弃牌堆时被引擎还原为原卡并删除影子 cardMap 条目,
//   使用结算结束后若按 atom.cardId 反查会落空 → eligible 比对失败,恃才对转化牌
//   静默不询问。修复:使用时 hook 把实体卡 id(shadowOf ?? cardId)记入结算帧参数。
//
// 覆盖:
//   1. 首次使用杀(基本牌)→ 询问发动;发动 → 牌置牌堆顶 + 摸一张(即收回该牌)
//   2. 回归:武圣转化杀 → 同样询问发动,发动后原卡回到手牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: 4,
    maxHealth: 4,
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

describe('恃才', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  function baseState(cardMap: Record<string, Card>, p0Hand: string[], p0Skills: string[]) {
    return createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '许攸',
          skills: ['恃才', ...p0Skills],
          hand: p0Hand,
        }),
        // 目标无闪:杀结算静默跳过,不产生额外询问
        makePlayer({ index: 1, name: '靶子', skills: [] }),
      ],
      cardMap: {
        ...cardMap,
        d0: makeCard('d0', '闪', '♦', '3'),
        d1: makeCard('d1', '桃', '♥', '4'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: ['d0', 'd1'], discardPile: [], processing: [] },
    });
  }

  async function useSlashAndConfirm(): Promise<void> {
    const P0 = harness.player('许攸');
    await waitForStable(harness.state); // 杀结算(P1 无闪,静默跳过)
    await waitForStable(harness.state); // 恃才询问 pending

    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot?.atom as { requestType?: string }).requestType).toBe('恃才/confirm');

    await P0.respond('恃才', { choice: true });
    await waitForStable(harness.state);
  }

  it('首次使用真实杀 → 询问发动;发动后此牌置顶再被摸回', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    await harness.setup(baseState({ s1: slash }, ['s1'], ['杀']));

    await harness.player('许攸').useCardAndTarget('杀', 's1', [1]);
    await useSlashAndConfirm();

    // 置顶(deck 末尾)后再摸一张 → s1 回到手牌,不留在弃牌堆
    expect(harness.state.players[0].hand).toContain('s1');
    expect(harness.state.zones.discardPile).not.toContain('s1');
  });

  it('回归:武圣转化杀同样询问发动;发动后原卡 c1 收回手牌', async () => {
    const redPeach = makeCard('c1', '桃', '♥', 'A');
    await harness.setup(baseState({ c1: redPeach }, ['c1'], ['武圣', '杀']));
    const P0 = harness.player('许攸');

    // 转化:红桃桃当杀
    await P0.transformThenUse('武圣', { cardId: 'c1' }, '杀', {
      cardId: 'c1#武圣',
      targets: [1],
    });
    await useSlashAndConfirm();

    // 修复前:eligible 比对落空 → 根本不询问;c1 滞留弃牌堆
    // 修复后:原卡置顶再摸回手牌
    expect(harness.state.players[0].hand).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c1');
  });
});
