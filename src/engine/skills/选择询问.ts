import { applyAtom } from "@engine/create-engine";
import { registerAction } from "@engine/skill";
import { GameState, Json, Skill } from "@engine/types";

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '选择询问',
    description: '选择一个选项',
  };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(
    skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlot;
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '选择询问') return '当前不是选择询问窗口';
      const choiceIdx = (params.choice as number) ?? 0;
      const choice = state.choiceQueue?.[choiceIdx];
      if (!choice) return '选择询问选项不存在';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const choiceIdx = (params.choice as number) ?? 0;
      await applyAtom(state, {type: '选择询问', choice: choiceIdx});
    },
  );
  return () => {};
}