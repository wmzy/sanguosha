// 龙胆(赵云·转化技):你可以将一张【杀】当【闪】使用或打出,或将一张【闪】当【杀】使用或打出。
//
// 模型(组合 action,武圣+倾国双向):一个 'transform' action 带 `to` 参数('闪'|'杀')。
//   - 杀当闪:preceding=[龙胆.transform{to:'闪'}] + 主 action=闪.respond(被询问闪时,防御向)
//   - 闪当杀:preceding=[龙胆.transform{to:'杀'}] + 主 action=杀.use(自己回合)/杀.respond(决斗/南蛮)
// 后端 dispatch 先执行 龙胆.transform(创建影子卡),再 闪/杀 的 validate 读 cardMap[影子id] 通过。
// 闪/杀 零感知龙胆——它们看到的永远是 cardMap 里的一张"闪"/"杀"。
// transform validate 不限定回合/阶段:杀当闪是防御向(非自己回合),闪当杀的回合/次数由 杀.use/respond 校验。
//
// 五件套(影子 id 后缀=技能 id '龙胆'、当作、rollback、defineAction)由 skillRuntime 工厂
// 统一实现;多向转化用 outputNameOf 按原卡名定向(产出牌名随选牌变化,与 CLAUDE.md
// 「转化方向由产出牌决定」一致),方向(to)校验经 extraValidate 追加(基础检查走工厂默认路径)。
import type { Card, GameView, GameState, Json, Skill, FrontendAPI } from '../types';
import { declareAlternativeResponse } from '../core/skill';
import { viewCanSlash, defaultPlayActive } from '../rules/action-active';
import {
  mountTransformAction,
  registerTransformAction,
  viewAskedDodge,
  viewAskedKill,
  type TransformActionOptions,
} from '../util/skillRuntime';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '龙胆',
    description: '你可以将一张【杀】当【闪】使用或打出,或将一张【闪】当【杀】使用或打出',
  };
}

/** 源卡名 → 转化目标牌名(双向映射;每张源卡唯一确定目标) */
const TRANSFORM_MAP: Record<string, string> = {
  杀: '闪',
  闪: '杀',
};

/** transform 五件套工厂配置(杀/闪互转,方向由原卡名推导)。 */
const TRANSFORM_OPTIONS: TransformActionOptions = {
  // 占位:实际产出牌名由 outputNameOf 按原卡名推导(杀→闪/闪→杀)
  outputName: '杀',
  outputNameOf: (sourceCardName: string) => TRANSFORM_MAP[sourceCardName],
  // 不限时机:杀当闪是防御向(非自己回合),闪当杀的回合/次数由主 action(杀.use/respond)校验
  context: 'any',
  // 方向(to)校验:基础检查(存活/持牌/牌存在)由工厂默认路径负责
  extraValidate: (state: GameState, _ownerId: number, params: Record<string, Json>) => {
    const cardId = params.cardId as string;
    const card = typeof cardId === 'string' ? state.cardMap[cardId] : undefined;
    // 推导/校验 to:to 缺省时按原卡名推导;给定时须与原卡名的映射一致
    // (浏览器 usePlayInteraction 与无头 availableActions 构造的 preceding 都只带 cardId——
    //  方向由 transform(card).name 决定,不放进 params;引擎硬性要求 to 会让真实客户端恒被拒)
    const expectedTo = card ? TRANSFORM_MAP[card.name] : undefined;
    const to = (params.to as string | undefined) ?? expectedTo;
    if (!expectedTo) return '只能将杀当闪或将闪当杀';
    if (to !== expectedTo) {
      if (to === '闪') return '只能将杀当闪';
      if (to === '杀') return '只能将闪当杀';
      return '无效的转化方向';
    }
    return null;
  },
  mount: {
    label: '龙胆',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张杀或闪转化',
      cardFilter: { filter: (c: Card) => c.name === '杀' || c.name === '闪', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 3,
        filter: (view: GameView, t: number) => {
          // 仅 闪→杀(出杀)需要目标;杀→闪 是 respond 无目标,前端按上下文决定
          return t !== view.currentPlayerIndex && view.players[t]?.alive;
        },
      },
    },
    activeWhen: (ctx) => {
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.alive) return false;
      const hasKillOrDodge = p.hand?.some((c) => c.name === '杀' || c.name === '闪') ?? false;
      if (!hasKillOrDodge) return false;
      // 三条激活路径:自己回合可出杀(闪→杀 use)/被询问闪(杀→闪)/被询问杀(闪→杀 respond,
      // 含激将/挑衅等委托回应窗口——viewAskedKill 与引擎 askedKillPendingFor 同源)
      const ownTurnCanSlash = defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx);
      return ownTurnCanSlash || viewAskedDodge(ctx) || viewAskedKill(ctx);
    },
  },
};

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把一张手牌(杀/闪)转化为影子"闪"/"杀"。
  // 作为 preceding 在 闪.respond / 杀.use / 杀.respond 之前执行。
  registerTransformAction(state, skill.id, ownerId, TRANSFORM_OPTIONS);
  const unloadDodge = declareAlternativeResponse(state, ownerId, '询问闪');
  const unloadSlash = declareAlternativeResponse(state, ownerId, '询问杀');
  return () => {
    unloadDodge();
    unloadSlash();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:龙胆是双向转化技,defineAction 声明杀/闪。
  // 前端 UI 流程:
  //   - 自己回合(出杀):选闪 → 点龙胆 → 提交 preceding=[龙胆.transform{to:'杀'}] + 主 action=杀.use
  //   - 被询问闪(防御):选杀 → 点龙胆 → 提交 preceding=[龙胆.transform{to:'闪'}] + 主 action=闪.respond
  mountTransformAction(api, skill.id, TRANSFORM_OPTIONS);
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
