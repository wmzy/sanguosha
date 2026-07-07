// 苦肉(黄盖):
//   出牌阶段，你可以失去1点体力，然后摸两张牌。
//   无次数限制，可多次发动。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '苦肉',
    description: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, _params: Record<string, Json>) => {
      const self = state.players[ownerId];
      if (!self) return 'player not found';
      if (!self.alive) return 'player is dead';
      if (self.health <= 0) return '体力不足，无法发动苦肉';
      return null;
    },
    async (state: GameState, _params: Record<string, Json>) => {
      const from = ownerId;
      await pushFrame(state, '苦肉', from, {});
      // 失去 1 点体力(非伤害——不触发伤害相关技能)
      await applyAtom(state, { type: '失去体力', target: from, amount: 1 });
      // 体力归零会进入濒死(求桃)流程:被救回则继续摸牌,无人救援则角色阵亡、后续摸牌不再执行
      if (state.players[from].alive) {
        // 摸 2 张牌
        await applyAtom(state, { type: '摸牌', player: from, count: 2 });
      }
      await popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '苦肉',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '苦肉：失去1点体力，然后摸两张牌',
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      (ctx.view.players[ctx.perspectiveIdx]?.health ?? 0) > 0,
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;