// src/engine/skills/倾国.ts
// 倾国(甄姬·转化技):你可以将一张黑色手牌当【闪】使用或打出。
//
// 模型(组合 action,与武圣对称):前端两步 UI(点倾国给黑牌加"闪"显示 → 点出闪),
// 提交时一个 ClientMessage:preceding=[倾国.transform] + 主 action=闪.respond。
// 后端 dispatch 先执行 倾国.transform(创建影子闪),再 闪.respond validate 看到"闪"通过。
// 闪技能零感知倾国——它看到的永远是 cardMap 里的一张"闪"。
// 五件套由 skillRuntime 工厂统一实现(context='any':被询问闪时打出,不限自己回合)。
import type { Card, GameState, Skill, FrontendAPI } from '../types';
import { declareAlternativeResponse } from '../core/skill';
import {
  registerTransformAction,
  mountTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';

const OPTIONS: TransformActionOptions = {
  outputName: '闪',
  // 不限时机:倾国用于"需要打出闪时"(被杀目标时),不是自己回合主动出
  context: 'any',
  cardPredicate: (state, _ownerId, cardIds) => state.cardMap[cardIds[0]]?.color === '黑',
  invalidError: '现在不能使用倾国',
  mount: {
    label: '倾国',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张黑色手牌当闪打出',
      cardFilter: { filter: (c: Card) => c.color === '黑', min: 1, max: 1 },
    },
    // 倾国只在被询问闪时激活(不依赖自己回合)
    activeWhen: (ctx) => {
      const slot = ctx.view.pending;
      if (!slot) return false;
      if ((slot.atom as { type: string }).type !== '询问闪') return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 手中有黑色牌才能发动
      const hasBlack = p.hand?.some((c) => c.color === '黑') ?? false;
      return hasBlack;
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '倾国',
    description: '你可以将一张黑色手牌当【闪】使用或打出',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把黑色手牌转化为影子"闪"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 闪.respond 之前执行。闪.validate 读 cardMap[影子id] 看到"闪"。
  registerTransformAction(state, skill.id, ownerId, OPTIONS);
  const unloadDecl = declareAlternativeResponse(state, ownerId, '询问闪');
  return () => { unloadDecl(); };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:倾国是转化技,defineAction 声明黑牌。
  // 前端 UI 流程:被询问闪时 → 选黑牌 → 点倾国按钮 → 提交 preceding=[倾国.transform] + 主 action=闪.respond。
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
