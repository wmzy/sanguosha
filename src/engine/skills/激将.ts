// src/engine/skills/激将.ts
// 激将(刘备·主公技):主公被南蛮入侵/万箭齐发等波及时,可请求其他蜀势力出杀/闪
// 简化实现:主动技 — 出牌阶段限一次,主公可请求一张杀
import type { BackendAPI, FrontendAPI, GameView, Json, EngineApi, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '激将',
    description: '主公技(出牌阶段限一次):主公可请求一名蜀势力角色出杀,若该角色不出则主公摸一张牌',
  };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      if (typeof params.target !== 'string') return 'target required';
      return null;
    },
    async (api: EngineApi) => {
      const from = api.self;
      const params = api.params;
      const target = params.target as string;
      const frame = api.pushFrame('激将', from, { ...params });
      // ─── Promise-based 续跑 ───
      await api.apply({
        type: '请求回应',
        requestType: '激将/respondKill',
        target,
        prompt: { type: 'confirm', title: '主公激将:是否出杀?' },
        timeout: 15000,
      });
      const responded = frame.params.__激将回应 as boolean | undefined;
      if (responded) {
        // 目标出杀:把目标的杀效果委托到杀技能
        const killTarget = frame.params.__激将杀目标 as string | undefined;
        if (killTarget) {
          await api.apply({ type: '指定目标', source: target, target: killTarget });
          await api.apply({ type: '询问闪', target: killTarget, source: target });
        }
      } else {
        // 目标不出:主公摸 1 张
        await api.apply({ type: '摸牌', player: from, count: 1 });
      }
      api.popFrame();
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '激将',
    style: 'primary',
    prompt: {
      type: 'choosePlayer',
      title: '激将：选择一名蜀势力角色出杀',
      min: 1,
      max: 1,
    },
  });
  return () => {};
}

export const module_激将: SkillModule = { createSkill, onInit, onMount };
registerSkillModule('激将', module_激将);
