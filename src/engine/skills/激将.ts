// src/engine/skills/激将.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/武将技能/蜀国/刘备.md):
//   激将(刘备·主公技):
//     - 触发时机:需要使用或打出【杀】时
//     - 发动条件:存活的其他蜀势力角色
//     - 效果:其他蜀势力角色可以打出一张【杀】(视为由你使用或打出)
//     - 限制:每回合无次数限制
//     - 备注:仅当刘备为主公时可用
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
//   1. **整体设计偏离规则**:激将不是"出牌阶段使用的主动技",
//      而是"主公需要使用/打出【杀】时被动触发的响应型技能"。
//      正确实现应该是 hook 询问杀 atom——主公被询问出杀时,自动并发询问所有
//      其他蜀势力角色"是否愿意代出杀"(按座次顺序,先回应者出杀,后回应者收到已被代出通知)。
//      当前的 use 设计完全是另一个技能,无法在主公被决斗/无杀可出时生效。
//   2. **缺少蜀势力判断**:choosePlayer 的 filter 是空的——任何 target 都能被选中,
//      违反规则中"令其他蜀势力角色"的限制(需检查 player.character.势力 === '蜀')。
//   3. **多余的摸牌奖励**:"不出则主公摸 1 张"在标准规则中**不存在**,
//      属于 ad-hoc 设计,可能是为了让主动技版本有意义而加。
//   4. **缺少多角色并发询问**:规则允许 N 个蜀国角色同时被询问,先回应者出杀;
//      当前实现是单点 target,不支持多个候选人并发询问。
//   5. **缺少主公技判断**:规则上"仅当刘备为主公时可用"——
//      当前实现未检查刘备是否主公身份(主公技:isLord 字段在 character 数据中需 cross-check)。
//   6. **触发时机错**:标准触发是"需要使用/打出杀时"——在杀.ts 处理出杀流程中
//      增加 hook(询问杀 atom after 或 before),让激将可以在无杀可出时
//      触发"其他蜀国角色代出杀"——当前完全不是这个时机。
//   5. respond 的回应数据通过 frame.params.__激将回应 / __激将杀目标 注入,
//      属于"通过 __ 私有字段 mutate frame"反模式(与 杀/闪 同问题)。
//   6. **缺失对应的 onMount UI 配置**——onMount 注册了 choosePlayer 但没限制蜀势力。
// ============================================================
import type { GameState, FrontendAPI, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '激将',
    description: '主公技(出牌阶段限一次):主公可请求一名蜀势力角色出杀,若该角色不出则主公摸一张牌',
  };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.target !== 'number') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      const target = params.target as number;
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
        const killTarget = frame.params.__激将杀目标 as number | undefined;
        if (killTarget !== undefined) {
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