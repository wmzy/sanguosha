// tests/skill-tests/contract.test.ts
// 前后端契约验证(正向):每个 defineAction 声明的 actionType 都有对应 registerAction。
// 反向检查暂不做(等 PR-A:给所有 backend-only skill 补 onMount 之后)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { findActionEntry } from '../../src/engine/core/skill';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';

function buildStateWithSkills(skillIds: string[]): GameState {
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P1',
        character: '主公',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: skillIds,
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
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
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 这些 skill 在 onInit 里 registerAction,故 defineAction 声明的 actionType
  // 都能在后端按 (skillId, ownerId, actionType) 三元组找到对应 registerAction。
  // 武圣 / 丈八蛇矛: onInit 显式 registerAction('transform')(创建影子杀),
  //   杀.use 走正常路径;无需跨 skill 路由。
  const SKILLS_WITH_OWN_REGISTER = ['仁德', '制衡', '激将', '武圣', '丈八蛇矛'];

  async function checkSkillDeclaredActions(skillId: string, h: SkillTestHarness) {
    await h.setup(buildStateWithSkills([skillId]));

    const P1 = h.player('P1');
    const declared = P1.availableActions();
    expect(declared.length).toBeGreaterThan(0);

    for (const def of declared) {
      const found = findActionEntry(h.state, def.skillId, def.ownerId, def.actionType);
      expect(
        found,
        `defineAction 声明了 ${def.skillId}:${def.actionType},但后端无对应 registerAction`,
      ).toBeDefined();
    }
  }

  it.each(SKILLS_WITH_OWN_REGISTER)(
    '%s: defineAction 声明的 actionType 都有对应 registerAction',
    async (skillId) => {
      await checkSkillDeclaredActions(skillId, harness);
    },
  );

});
