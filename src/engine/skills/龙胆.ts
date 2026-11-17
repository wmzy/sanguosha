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
//
// 本文件同时导出 createLongdanSkill 工厂(龙胆族共享实现),界龙胆 复用之,仅注入
// 转化映射/文案/激活谓词/额外替代回应差异(影子卡 id 后缀=各技能 id,键空间按技能 id 隔离)。
import type {
  ActionContext,
  Card,
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { declareAlternativeResponse } from '../core/skill';
import { viewCanSlash, defaultPlayActive } from '../rules/action-active';
import {
  mountTransformAction,
  registerTransformAction,
  viewAskedDodge,
  viewAskedKill,
  type TransformActionOptions,
} from '../util/skillRuntime';
import type { SkillModule } from '../types';

/** 视图玩家(激活谓词注入方拿到的 ctx.view.players[perspectiveIdx] 元素)。 */
export type ViewPlayer = GameView['players'][number];

/** 龙胆族差异参数(标/界共享实现,差异全部显式注入)。 */
export interface LongdanOptions {
  /** 玩家可见技能名(标 '龙胆' / 界 '界龙胆';= 影子卡 id 后缀与注册键空间) */
  displayName: string;
  description: string;
  /** 源卡名 → 转化目标牌名(双向映射;每张源卡唯一确定目标。标 2 项 / 界 4 项) */
  transformMap: Record<string, string>;
  /** 转化面板标题 */
  promptTitle: string;
  /** 转化面板源牌过滤(标 杀|闪 / 界 杀|闪|酒|桃) */
  sourceCardFilter: (c: Card) => boolean;
  /** extraValidate:源牌不在映射内的拒绝文案 */
  invalidSourceError: string;
  /** extraValidate:方向(to)与原卡名映射不符时的拒绝文案(标版按方向细分,界版统一) */
  directionMismatchError: (to: string) => string;
  /** 激活谓词(perspectiveIdx 玩家存活检查已由工厂完成;持牌/路径判断在此) */
  activeWhen: (ctx: ActionContext, p: ViewPlayer) => boolean;
  /** 额外的替代回应声明(界版:濒死求桃 ['请求回应', '桃/求桃'];标版:无) */
  extraAlternativeResponses?: Array<[atomType: string, requestType?: string]>;
}

/** 龙胆族共享实现:标龙胆与界龙胆仅 转化映射/文案/激活谓词/额外替代回应 不同,
 *  transform 五件套、方向校验骨架、面板与 onInit/onMount 流程逐字一致。 */
export function createLongdanSkill(opts: LongdanOptions) {
  /** transform 五件套工厂配置(方向由原卡名推导)。 */
  const TRANSFORM_OPTIONS: TransformActionOptions = {
    // 占位:实际产出牌名由 outputNameOf 按原卡名推导(标 杀→闪/闪→杀;界另含 酒↔桃)
    outputName: '杀',
    outputNameOf: (sourceCardName: string) => opts.transformMap[sourceCardName],
    // 不限时机:杀当闪是防御向(非自己回合),回合/次数由主 action(杀.use/respond 等)校验
    context: 'any',
    // 方向(to)校验:基础检查(存活/持牌/牌存在)由工厂默认路径负责
    extraValidate: (state: GameState, _ownerId: number, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const card = typeof cardId === 'string' ? state.cardMap[cardId] : undefined;
      // 推导/校验 to:to 缺省时按原卡名推导;给定时须与原卡名的映射一致
      // (浏览器 usePlayInteraction 与无头 availableActions 构造的 preceding 都只带 cardId——
      //  方向由 transform(card).name 决定,不放进 params;引擎硬性要求 to 会让真实客户端恒被拒)
      const expectedTo = card ? opts.transformMap[card.name] : undefined;
      const to = (params.to as string | undefined) ?? expectedTo;
      if (!expectedTo) return opts.invalidSourceError;
      if (to !== expectedTo) return opts.directionMismatchError(to as string);
      return null;
    },
    mount: {
      label: opts.displayName,
      style: 'passive',
      prompt: {
        type: 'useCardAndTarget',
        title: opts.promptTitle,
        cardFilter: { filter: opts.sourceCardFilter, min: 1, max: 1 },
        targetFilter: {
          min: 1,
          max: 3,
          filter: (view: GameView, t: number) => {
            // 仅「对他人使用」方向需要目标(标 闪→杀 / 界另含 酒→桃);
            // respond 向(杀→闪/濒死求桃)无目标,前端按上下文决定
            return t !== view.currentPlayerIndex && view.players[t]?.alive;
          },
        },
      },
      activeWhen: (ctx: ActionContext) => {
        const p = ctx.view.players[ctx.perspectiveIdx];
        if (!p?.alive) return false;
        return opts.activeWhen(ctx, p);
      },
    },
  };

  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.displayName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;
    // transform action:把一张手牌转化为影子目标牌(标 杀/闪,界 杀/闪/酒/桃)。
    // 作为 preceding 在主 action(闪/杀/桃/酒 的 use/respond)之前执行。
    registerTransformAction(state, skill.id, ownerId, TRANSFORM_OPTIONS);
    const unloads = [
      declareAlternativeResponse(state, ownerId, '询问闪'),
      declareAlternativeResponse(state, ownerId, '询问杀'),
      ...(opts.extraAlternativeResponses ?? []).map(([atomType, requestType]) =>
        declareAlternativeResponse(state, ownerId, atomType, requestType),
      ),
    ];
    return () => {
      unloads.forEach((u) => u());
    };
  }

  function onMount(skill: Skill, api: FrontendAPI): void {
    // 前端:龙胆族是多向转化技,defineAction 由工厂按 sourceCardFilter 声明源牌。
    // 前端 UI 流程(以标版为例,界版同理):
    //   - 自己回合(出杀):选闪 → 点龙胆 → 提交 preceding=[龙胆.transform{to:'杀'}] + 主 action=杀.use
    //   - 被询问闪(防御):选杀 → 点龙胆 → 提交 preceding=[龙胆.transform{to:'闪'}] + 主 action=闪.respond
    mountTransformAction(api, skill.id, TRANSFORM_OPTIONS);
  }

  return { createSkill, onInit, onMount };
}

/** 源卡名 → 转化目标牌名(双向映射;每张源卡唯一确定目标) */
const TRANSFORM_MAP: Record<string, string> = {
  杀: '闪',
  闪: '杀',
};

const OPTIONS: LongdanOptions = {
  displayName: '龙胆',
  description: '你可以将一张【杀】当【闪】使用或打出,或将一张【闪】当【杀】使用或打出',
  transformMap: TRANSFORM_MAP,
  promptTitle: '选择一张杀或闪转化',
  sourceCardFilter: (c: Card) => c.name === '杀' || c.name === '闪',
  invalidSourceError: '只能将杀当闪或将闪当杀',
  directionMismatchError: (to) => {
    if (to === '闪') return '只能将杀当闪';
    if (to === '杀') return '只能将闪当杀';
    return '无效的转化方向';
  },
  activeWhen: (ctx, p) => {
    const hasKillOrDodge = p.hand?.some((c) => c.name === '杀' || c.name === '闪') ?? false;
    if (!hasKillOrDodge) return false;
    // 三条激活路径:自己回合可出杀(闪→杀 use)/被询问闪(杀→闪)/被询问杀(闪→杀 respond,
    // 含激将/挑衅等委托回应窗口——viewAskedKill 与引擎 askedKillPendingFor 同源)
    const ownTurnCanSlash = defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx);
    return ownTurnCanSlash || viewAskedDodge(ctx) || viewAskedKill(ctx);
  },
};

export const { createSkill, onInit, onMount } = createLongdanSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
