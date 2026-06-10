// src/engine/skills/激将.ts
// 激将(刘备·主公技):主公被南蛮入侵/万箭齐发等波及时,可请求其他蜀势力出杀/闪
// 简化实现:主动技 — 出牌阶段限一次,主公可请求一张杀
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '激将',
    description: '主公技(出牌阶段限一次):主公可请求一名蜀势力角色出杀,若该角色不出则主公摸一张牌',
  };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      if (typeof params.target !== 'string') return 'target required';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const target = params.target as string;
      // 简化:直接向 target 发请求回应(实装 PR 后续)
      await frame.apply({
        type: '请求回应',
        requestType: '激将/respondKill',
        target,
        prompt: { type: 'confirm', title: '主公激将:是否出杀?' },
        timeout: 15000,
      });
      // 等待回应结果(简化:由后续 PR 通过 settlement 共享参数读取)
    },
  );
  return () => {};
}

export const module_激将: SkillModule = { createSkill, onInit };
registerSkillModule('激将', module_激将);
