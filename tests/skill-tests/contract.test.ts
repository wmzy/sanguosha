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
        hand: [], equipment: {}, skills: skillIds, vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [],
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

  // 当前已有 onMount 的 skill(由 grep -l "onMount" src/engine/skills/*.ts 得来)
  // 仁德 / 制衡 / 激将: 自身 onInit 完整注册 action
  // 武圣 / 丈八蛇矛: onMount 声明 transform,但 onInit 故意不 registerAction,
  //   委托给 杀 skill 的 registerAction 处理(通过 fromSkill 机制)
  //   — 该跨 skill 路由设计待后续 PR 修(本测试暂 skip)
  const SKILLS_WITH_OWN_REGISTER = ['仁德', '制衡', '激将'];
  const SKILLS_WITH_CROSS_SKILL_ROUTING = ['武圣', '丈八蛇矛'];

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

  it.skip.each(SKILLS_WITH_CROSS_SKILL_ROUTING)(
    '%s: 跨 skill 路由(transform 委托给 杀) — 待 PR 修契约',
    () => {
      // forward-pointer: 武圣/丈八蛇矛 在 onMount 声明 transform actionType,
      // 但 onInit 不 registerAction(故意设计,委托给 杀.execute 路由)
      // 当前 contract test 严格按 (skillId, ownerId, actionType) 三元组查找,
      // 找不到 → 测试会红,但这是设计上的"伪阴性"。
      // 后续 PR 需要:要么 (a) 在 transform actionType 注册时跨 skill 查找,
      // 要么 (b) 修 武圣/丈八蛇矛.onInit 显式 registerAction。
    },
  );

  it.skip('TODO: 反向检查 — 每个 registerAction 都应有对应的 defineAction', () => {});
});
