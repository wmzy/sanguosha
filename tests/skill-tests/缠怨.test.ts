import { describe, expect, it } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { isHookSuppressed } from '../../src/engine/core/skill-suppression';
import { effectiveDistance } from '../../src/engine/rules/distance';
import { viewEffectiveDistance } from '../../src/engine/rules/viewDistance';
import { canSlash } from '../../src/engine/rules/slash-quota';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makePlayer(index: number, skills: string[] = [], hand: string[] = []): GameState['players'][number] {
  return {
    index, name: `P${index}`, character: '测试', faction: '群', health: index === 0 ? 1 : 3,
    maxHealth: 4, alive: true, hand, equipment: {}, skills, vars: {}, marks: [],
    pendingTricks: [], tags: [], judgeZone: [],
  };
}

function makeCard(id: string, name: string): Card {
  return { id, name, type: '基本牌', suit: '♥', color: '红', rank: 'A' };
}

describe('缠怨', () => {
  it('1体力时禁用自有主动技和锁定技被动，但不影响普通牌或装备距离修正', async () => {
    const harness = new SkillTestHarness();
    await harness.setup(createGameState({
      players: [
        makePlayer(0, ['缠怨', '仁德', '咆哮', '马术', '桃'], ['peach']),
        makePlayer(1), makePlayer(2), makePlayer(3),
      ],
      cardMap: { peach: makeCard('peach', '桃') },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '杀/quotaUsed': 1 } },
    }));

    expect(isHookSuppressed(harness.state, 0, '仁德')).toBe(true);
    expect(isHookSuppressed(harness.state, 0, '咆哮')).toBe(true);
    expect(isHookSuppressed(harness.state, 0, '八卦阵')).toBe(false);
    expect(canSlash(harness.state, 0)).toBe(false);
    expect(effectiveDistance(harness.state, 0, 2)).toBe(2);
    expect(viewEffectiveDistance(harness.player(0).view.players, 0, 2)).toBe(2);

    await harness.player(0).expectRejected({
      skillId: '仁德', actionType: 'use', params: { targets: [{ target: 1, cardIds: ['peach'] }] },
    });
    await harness.player(0).useCardAndTarget('桃', 'peach', [0]);
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.zones.discardPile).toContain('peach');
  });
});
