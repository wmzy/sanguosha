// src/engine/skills/激将.ts
// 激将(刘备·主公技):主公被南蛮入侵/万箭齐发等波及时,可请求其他蜀势力出杀/闪
// 简化实现:主动技 — 出牌阶段限一次,主公可请求一张杀
import type { BackendAPI, FrontendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
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
      // 注册续跑:请求回应后的处理
      frame._continueFn = async () => {
        // 读回应结果:ctx.params.__激将回应 === true 表示目标出杀
        const responded = frame.params.__激将回应 as boolean | undefined;
        if (responded) {
          // 目标出杀:把目标的杀效果委托到杀技能
          // 简化:直接 apply 一次杀的结算(指定目标=主公当前攻击范围第一个目标)
          // 实际应让目标选杀的目标,此处用 frame.params.__激将杀目标
          const killTarget = frame.params.__激将杀目标 as string | undefined;
          if (killTarget) {
            await frame.apply({ type: '指定目标', source: target, target: killTarget });
            await frame.apply({ type: '询问闪', target: killTarget, source: target });
            // 询问闪的续跑不再注册,直接结算
            // 简化:杀的结果由 dispatch 的 _continueFn 机制处理
          }
        } else {
          // 目标不出:主公摸 1 张
          await frame.apply({ type: '摸牌', player: from, count: 1 });
        }
      };
      // 向目标请求回应
      await frame.apply({
        type: '请求回应',
        requestType: '激将/respondKill',
        target,
        prompt: { type: 'confirm', title: '主公激将:是否出杀?' },
        timeout: 15000,
      });
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
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
