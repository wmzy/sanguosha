// 界龙胆(界赵云·转化技):你可以将一张【杀】当【闪】、【闪】当【杀】、
//   【酒】当【桃】、【桃】当【酒】使用或打出。
//
// OL 官方(hero/302)逐字:
//   "你可以将一张【杀】当【闪】、【闪】当【杀】、【酒】当【桃】、【桃】当【酒】使用或打出。"
//
// 与标龙胆区别:标版仅 杀↔闪 双向;界版扩展为四向——杀↔闪 + 酒↔桃。
//   独立界版技能文件,不修改标龙胆。影子卡 id 键为 '界龙胆'(与标龙胆隔离)。
//
// 模型(组合 action,标龙胆四向扩展):一个 'transform' action 带 `to` 参数
//   ('闪'|'杀'|'桃'|'酒')。每张源卡名唯一确定目标牌名(双向映射),故:
//   - 前端/测试传 `to` 时,validate 校验与原卡名映射一致;
//   - headless availableActions 不传 `to`,后端按原卡名推导(兼容)。
//   - 杀当闪:preceding=[界龙胆.transform{to:'闪'}] + 主 action=闪.respond(被询问闪)
//   - 闪当杀:preceding=[界龙胆.transform{to:'杀'}] + 主 action=杀.use/respond
//   - 酒当桃:preceding=[界龙胆.transform{to:'桃'}] + 主 action=桃.use(回血)/桃.respond(濒死求桃)
//   - 桃当酒:preceding=[界龙胆.transform{to:'酒'}] + 主 action=酒.use(增伤)/酒.respond(濒死求桃)
// 后端 dispatch 先执行 界龙胆.transform(创建影子卡),再主 action validate 读 cardMap[影子id] 通过。
// 主 action(闪/杀/桃/酒)零感知界龙胆——它们看到的永远是 cardMap 里的目标牌。
// transform validate 不限定回合/阶段:由主 action(杀.use/桃.use/酒.use/respond 等)校验。
//
// 五件套(影子 id 后缀=技能 id '界龙胆'、当作、rollback、defineAction)由 skillRuntime 工厂
// 统一实现;四向转化用 outputNameOf 按原卡名定向,方向(to)校验经 extraValidate 追加
// (基础检查走工厂默认路径)。
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

/** 源卡名 → 转化目标牌名(四向双向映射;每张源卡唯一确定目标) */
const TRANSFORM_MAP: Record<string, string> = {
  杀: '闪',
  闪: '杀',
  酒: '桃',
  桃: '酒',
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界龙胆',
    description:
      '你可以将一张【杀】当【闪】、【闪】当【杀】、【酒】当【桃】、【桃】当【酒】使用或打出',
  };
}

/** transform 五件套工厂配置(杀↔闪 + 酒↔桃,方向由原卡名推导)。 */
const TRANSFORM_OPTIONS: TransformActionOptions = {
  // 占位:实际产出牌名由 outputNameOf 按原卡名推导
  outputName: '杀',
  outputNameOf: (sourceCardName: string) => TRANSFORM_MAP[sourceCardName],
  // 不限时机:时机由主 action(杀.use/桃.use/酒.use/respond 等)校验
  context: 'any',
  // 方向(to)校验:基础检查(存活/持牌/牌存在)由工厂默认路径负责
  extraValidate: (state: GameState, _ownerId: number, params: Record<string, Json>) => {
    const cardId = params.cardId as string;
    const card = typeof cardId === 'string' ? state.cardMap[cardId] : undefined;
    // 推导/校验 to:to 缺省时按原卡名推导;给定时须与原卡名的映射一致
    const expectedTo = card ? TRANSFORM_MAP[card.name] : undefined;
    const to = (params.to as string | undefined) ?? expectedTo;
    if (!expectedTo) return '该牌不能被界龙胆转化';
    if (to !== expectedTo) return '转化方向与原牌不符';
    return null;
  },
  mount: {
    label: '界龙胆',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张杀/闪/酒/桃转化',
      cardFilter: {
        filter: (c: Card) =>
          c.name === '杀' || c.name === '闪' || c.name === '酒' || c.name === '桃',
        min: 1,
        max: 1,
      },
      targetFilter: {
        min: 1,
        max: 3,
        filter: (view: GameView, t: number) => {
          // 出杀/对他人出桃需目标;respond(闪/濒死求桃)无目标,前端按上下文决定
          const me = view.currentPlayerIndex;
          return t !== me && view.players[t]?.alive;
        },
      },
    },
    activeWhen: (ctx) => {
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.alive) return false;
      const hand = p.hand ?? [];
      const has = (n: string) => hand.some((c) => c.name === n);
      // 路径①:自己回合出牌阶段
      //   - 闪→杀(还能出杀)
      //   - 酒→桃(已受伤,桃.use 要求 health<maxHealth)
      //   - 桃→酒(酒.use 无体力限制,任何时候自己回合可用)
      //   (杀→闪在自己回合无意义——闪无 use action,故不激活)
      if (defaultPlayActive(ctx)) {
        if (has('闪') && viewCanSlash(ctx.view, ctx.perspectiveIdx)) return true;
        if (has('酒') && p.health < p.maxHealth) return true;
        if (has('桃')) return true;
      }
      // 路径②:被询问闪(防御向,杀→闪)/被询问杀(进攻向 respond,闪→杀——含激将/挑衅等
      // 委托回应窗口,viewAskedKill 与引擎 askedKillPendingFor 同源)
      if (viewAskedDodge(ctx) && has('杀')) return true;
      if (viewAskedKill(ctx) && has('闪')) return true;
      return false;
    },
  },
};

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把一张手牌(杀/闪/酒/桃)转化为影子目标牌。
  // 作为 preceding 在主 action(闪/杀/桃/酒 的 use/respond)之前执行。
  registerTransformAction(state, skill.id, ownerId, TRANSFORM_OPTIONS);
  const unloadDodge = declareAlternativeResponse(state, ownerId, '询问闪');
  const unloadSlash = declareAlternativeResponse(state, ownerId, '询问杀');
  const unloadRescue = declareAlternativeResponse(state, ownerId, '请求回应', '桃/求桃');
  return () => { unloadDodge(); unloadSlash(); unloadRescue(); };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:界龙胆是四向转化技,defineAction 声明杀/闪/酒/桃。
  // 前端 UI 流程:
  //   - 自己回合(出杀):选闪 → 点界龙胆 → preceding=[界龙胆.transform{to:'杀'}] + 主 action=杀.use
  //   - 被询问闪(防御):选杀 → 点界龙胆 → preceding=[界龙胆.transform{to:'闪'}] + 主 action=闪.respond
  //   - 自己回合(回血):选酒(已受伤) → 点界龙胆 → preceding=[界龙胆.transform{to:'桃'}] + 主 action=桃.use
  //   - 自己回合(增伤):选桃 → 点界龙胆 → preceding=[界龙胆.transform{to:'酒'}] + 主 action=酒.use
  mountTransformAction(api, skill.id, TRANSFORM_OPTIONS);
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
