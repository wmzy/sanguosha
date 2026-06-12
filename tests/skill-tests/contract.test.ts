// tests/skill-tests/contract.test.ts
// 前后端契约验证(正向):每个 defineAction 声明的 actionType 都有对应 registerAction。
// 反向检查暂不做(等 PR-A:给所有 backend-only skill 补 onMount 之后)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { findActionEntry } from '../../src/engine/skill';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';

function buildStateWithSkills(skillIds: string[]): GameState {
  return createGameState({
    players: [
      {
        index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
        hand: [], equipment: {}, skills: skillIds, vars: {}, marks: [], pendingTricks: [], judgeZone: [],
      },
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('前端 → 后端契约', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  // 当前已有 onMount 的 skill(由 grep -l "onMount" src/engine/skills/*.ts 得来)
  const SKILLS_WITH_ONMOUNT = ['武圣', '仁德', '制衡', '激将', '丈八蛇矛'];

  for (const skillId of SKILLS_WITH_ONMOUNT) {
    it(`${skillId}: defineAction 声明的 actionType 都有对应 registerAction`, () => {
      harness.setup(buildStateWithSkills([skillId]));

      const P1 = harness.player('P1');
      const declared = P1.availableActions();
      expect(declared.length).toBeGreaterThan(0);

      for (const def of declared) {
        const found = findActionEntry(def.skillId, def.ownerId, def.actionType);
        expect(
          found,
          `${skillId}.${def.actionType} declared in onMount but not registered in onInit`,
        ).toBeDefined();
      }
    });
  }

  it.skip('TODO: 反向检查 — 每个 registerAction 都应有对应的 defineAction', () => {});
});
