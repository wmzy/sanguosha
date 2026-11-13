// 火计(卧龙诸葛·转化技):你可以将一张红色手牌当【火攻】使用。
//
// 模型(组合 action,镜像武圣):前端选红牌 → 选目标(有手牌的其他角色) →
// 提交 preceding=[火计.transform] + 主 action=火攻.use。
// 后端 dispatch 先执行 火计.transform(创建影子火攻),再 火攻.use validate
// 看到"火攻"通过。火攻技能零感知火计——它看到的永远是 cardMap 里的"火攻"。
// 五件套由 skillRuntime 工厂统一实现(仅手牌来源 + 红牌谓词 + 默认出牌时机)。
import type { Card, FrontendAPI, GameView, GameState, Skill } from '../types';
import { defaultPlayActive } from '../rules/action-active';
import {
  registerTransformAction,
  mountTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';

const OPTIONS: TransformActionOptions = {
  outputName: '火攻',
  cardPredicate: (state, _ownerId, cardIds) => state.cardMap[cardIds[0]]?.color === '红',
  invalidError: '现在不能使用火计',
  mount: {
    label: '火计',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色牌当火攻使用',
      cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 目标须有手牌(前端 UI 提示用,后端 validate 独立校验)
        filter: (view: GameView, t: number) =>
          (view.players[t]?.handCount ?? 0) > 0,
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return p.hand?.some((c) => c.color === '红') ?? false;
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '火计',
    description: '你可以将一张红色手牌当【火攻】使用',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  // transform action:把红色手牌转化为影子"火攻"。作为 preceding 在 火攻.use 之前执行。
  registerTransformAction(state, skill.id, skill.ownerId, OPTIONS);
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:火计是转化技,defineAction 声明红牌 + 目标(有手牌的角色,可对自己使用火攻)。
  // 前端 UI 流程:选红牌 → 选目标 → 提交 preceding=[火计.transform] + 主 action=火攻.use。
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
