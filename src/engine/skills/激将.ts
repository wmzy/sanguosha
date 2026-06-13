// src/engine/skills/激将.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   激将(刘备·主公技,锁定技):当你需要使用或打出一张【杀】时,
//   你可以令其他蜀势力角色选择是否打出【杀】(由其代为打出/使用)。
//
// 关键原子操作(当前实现 — 与规则不符):
//   use 路径(主动技):
//     pushFrame → 请求回应(target 是否出杀) → 若回应: 指定目标 + 询问闪;
//     若未回应: 主公摸 1 张 → popFrame
//
// 关键时机(规则):
//   - 触发型:在主公需要使用/打出【杀】时被动触发(决斗、被借刀杀人、出杀阶段无杀可出等),
//     不是出牌阶段限一次的主动技
//
// 已知问题/不完整实现:
//   1. **整体设计偏离规则**:激将不是主动技,而是"被询问杀时触发的锁定技"。
//      正确实现应该是 hook 询问杀 atom——主公被询问出杀时,自动并发询问所有其他蜀势力角色。
//      当前的 use 设计完全是另一个技能,无法在主公被决斗/无杀可出时生效。
//   2. **缺少蜀势力判断**:choosePlayer 的 filter 是空的——任何 target 都能被选中,
//      违反规则中"令其他蜀势力角色"的限制。
//   3. **多余的摸牌奖励**:"不出则主公摸 1 张"在标准规则中不存在,
//      属于 ad-hoc 设计,可能是为了让主动技版本有意义而加。
//   4. **缺少多角色并发询问**:规则允许 N 个蜀国角色同时被询问,先回应者出杀;
//      当前实现是单点 target,不支持多个候选人。
//   5. respond 的回应数据通过 frame.params.__激将回应 / __激将杀目标 注入,
//      属于"通过 __ 私有字段 mutate frame"反模式(与 杀/闪 同问题)。
//   6. **缺失对应的 onMount UI 配置**——onMount 注册了 choosePlayer 但没限制蜀势力。
// ============================================================
import type { GameState, FrontendAPI, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '激将',
    description: '主公技(出牌阶段限一次):主公可请求一名蜀势力角色出杀,若该角色不出则主公摸一张牌',
  };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.target !== 'string') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const target = params.target as string;
      const frame = pushFrame(state, '激将', from, { ...params });
      // ─── Promise-based 续跑 ───
      await applyAtom(state, {
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
          await applyAtom(state, { type: '指定目标', source: target, target: killTarget });
          await applyAtom(state, { type: '询问闪', target: killTarget, source: target });
        }
      } else {
        // 目标不出:主公摸 1 张
        await applyAtom(state, { type: '摸牌', player: from, count: 1 });
      }
      popFrame(state);
    }, );
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

export default { createSkill, onInit, onMount };
