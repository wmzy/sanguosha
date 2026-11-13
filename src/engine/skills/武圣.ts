// src/engine/skills/武圣.ts
// 武圣(关羽·转化技):将一张红色牌当【杀】使用或打出。
//
// 模型(组合 action):前端两步 UI(点武圣给红牌加"杀"显示 → 点出杀选目标),
// 提交时一个 ClientMessage:preceding=[武圣.transform] + 主 action=杀.use。
// 后端 dispatch 先执行 武圣.transform(创建影子杀),再 杀.use validate 看到"杀"通过。
// 杀技能零感知武圣——它看到的永远是 cardMap 里的一张“杀”。
// 五件套(shadowId/validate/execute/rollback/defineAction)由 skillRuntime 工厂统一实现。
import type { Card, GameView, GameState, Skill, FrontendAPI } from '../types';
import { declareAlternativeResponse } from '../core/skill';
import { viewCanAttack } from '../rules/viewDistance';
import { defaultPlayActive, viewCanSlash } from '../rules/action-active';
import {
  registerTransformAction,
  mountTransformAction,
  viewAskedKill,
  type TransformActionOptions,
} from '../util/skillRuntime';

const OPTIONS: TransformActionOptions = {
  outputName: '杀',
  // 时机:出杀路径(自己回合出牌阶段)或回应路径(被询问杀:南蛮入侵/决斗/激将/挑衅)
  context: 'playOrRespondKill',
  cardPredicate: (state, _ownerId, cardIds) => state.cardMap[cardIds[0]]?.color === '红',
  invalidError: '现在不能使用武圣',
  mount: {
    label: '武圣',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色牌当杀使用',
      cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 攻击范围检查(转化出的杀同样需距离):filter 仅为前端 UI 提示(出杀路径用)
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    activeWhen: (ctx) => {
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.alive) return false;
      const hasRed = p.hand?.some((c) => c.color === '红') ?? false;
      if (!hasRed) return false;
      // 出杀路径(自己回合 + 出牌阶段 + 还能出杀)或回应路径(被询问杀):与龙胆同构
      return (
        (defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx)) ||
        viewAskedKill(ctx)
      );
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '武圣',
    description: '你可以将一张红色牌当【杀】使用或打出',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把红色手牌转化为影子"杀"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 杀.use(出牌阶段)/ 杀.respond(被询问杀)之前执行。
  const unloadTransform = registerTransformAction(state, skill.id, ownerId, OPTIONS);
  // 声明替代回应:被询问杀(南蛮入侵/决斗 等)时,可用武圣把红色手牌当杀打出。
  // 与龙胆/倾国同构:声明后 询问杀 的可用性检测不再 skip,建立回应窗口。
  const unloadAlt = declareAlternativeResponse(state, ownerId, '询问杀');
  return () => {
    unloadAlt();
    unloadTransform();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:武圣是转化技,defineAction 声明红牌+目标。
  // 前端 UI 流程(出杀):选红牌 → 选目标 → 点武圣按钮 → 提交 preceding=[武圣.transform] + 杀.use。
  // 前端 UI 流程(打出):被询问杀时(南蛮/决斗),选红牌 → 点武圣按钮 → preceding + 杀.respond。
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}
