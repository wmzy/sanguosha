// src/engine/skills/奇袭.ts
// 奇袭(甘宁·转化技):你可以将一张黑色牌当【过河拆桥】使用。
//
// 模型(组合 action,镜像火计/武圣):前端两步 UI(点奇袭给黑牌加"过河拆桥"显示 →
// 点过河拆桥选目标),提交时一个 ClientMessage:
//   preceding=[奇袭.transform] + 主 action=过河拆桥.use。
// 后端 dispatch 先执行 奇袭.transform(创建影子过河拆桥),再 过河拆桥.use validate
// 看到"过河拆桥"通过。过河拆桥技能零感知奇袭——它看到的永远是 cardMap 里的"过河拆桥"。
//
// 与火计/武圣的差异:黑色牌可以是手牌或装备区的牌(描述明确允许装备区黑色牌)——
// 由工厂 includeEquipment 维度实现:装备牌先「卸下」(装备区→手牌,产生 ViewEvent +
// 清除武器距离 vars)再用「当作」;rollback 还原槽位与距离 vars。
//
// 原牌归宿:影子过河拆桥入弃牌堆时,引擎按 shadowOf 还原为原卡(见 移动牌.apply),
// 因此无论原牌来自手牌还是装备区,最终都进入弃牌堆(满足"使用后原牌进入弃牌堆")。
// 奇袭出过河拆桥可被无懈可击抵消——由 过河拆桥.use 自身的 询问无懈可击 流程保证,
// 与转化来源无关。
// 五件套由 skillRuntime 工厂统一实现。
import type { Card, FrontendAPI, GameState, Skill } from '../types';
import { defaultPlayActive } from '../rules/action-active';
import {
  registerTransformAction,
  mountTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';

const OPTIONS: TransformActionOptions = {
  outputName: '过河拆桥',
  // 黑色牌可以在手牌或装备区(描述:有黑色牌——手牌或装备区的牌)
  includeEquipment: true,
  cardPredicate: (state, _ownerId, cardIds) => state.cardMap[cardIds[0]]?.color === '黑',
  invalidError: '现在不能使用奇袭',
  mount: {
    label: '奇袭',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张黑色牌当过河拆桥使用',
      cardFilter: { filter: (c: Card) => c.color === '黑', min: 1, max: 1 },
      // 目标过滤与过河拆桥一致:其他角色即可(后端 validate 独立校验非自身/存活/有牌)
      targetFilter: { min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 手牌或装备区有黑色牌即可发动
      const hasBlackInHand = p.hand?.some((c) => c.color === '黑') ?? false;
      if (hasBlackInHand) return true;
      const equipIds = Object.values(p.equipment ?? {});
      const hasBlackEquip = equipIds.some((id) => {
        const card = id ? ctx.view.cardMap[id] : undefined;
        return card?.color === '黑';
      });
      return hasBlackEquip;
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '奇袭',
    description: '你可以将一张黑色牌当【过河拆桥】使用',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  // transform action:把黑色牌(手牌/装备)转化为影子"过河拆桥"。
  // 作为 preceding 在 过河拆桥.use 之前执行。过河拆桥.validate 读 cardMap[影子id] 看到"过河拆桥"。
  registerTransformAction(state, skill.id, skill.ownerId, OPTIONS);
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:奇袭是转化技,defineAction 声明黑牌 + 目标。
  // 前端 UI 流程:选黑牌 → 选目标 → 点奇袭按钮 →
  // 提交 preceding=[奇袭.transform] + 主 action=过河拆桥.use。
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
