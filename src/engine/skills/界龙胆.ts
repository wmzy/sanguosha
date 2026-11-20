// 界龙胆(界赵云·转化技):你可以将一张【杀】当【闪】、【闪】当【杀】、
//   【酒】当【桃】、【桃】当【酒】使用或打出。
//
// OL 官方(hero/302)逐字:
//   "你可以将一张【杀】当【闪】、【闪】当【杀】、【酒】当【桃】、【桃】当【酒】使用或打出。"
//
// 与标龙胆区别:标版仅 杀↔闪 双向;界版扩展为四向——杀↔闪 + 酒↔桃。
//   独立界版技能文件,复用 龙胆.ts 导出的 createLongdanSkill 工厂,仅注入四向映射/
//   文案/激活谓词/濒死求桃替代回应。影子卡 id 键为 '界龙胆'(与标龙胆隔离)。
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
// 五件套(影子 id 后缀=技能 id '界龙胆')由 skillRuntime 工厂统一实现,骨架见 龙胆.ts。
import type { ActionContext, Card } from '../types';
import { viewCanSlash, defaultPlayActive } from '../rules/action-active';
import { viewAskedDodge, viewAskedKill } from '../util/skillRuntime';
import { createLongdanSkill, type LongdanOptions, type ViewPlayer } from './龙胆';
import type { SkillModule } from '../types';

/** 源卡名 → 转化目标牌名(四向双向映射;每张源卡唯一确定目标) */
const TRANSFORM_MAP: Record<string, string> = {
  杀: '闪',
  闪: '杀',
  酒: '桃',
  桃: '酒',
};

const OPTIONS: LongdanOptions = {
  displayName: '界龙胆',
  description:
    '你可以将一张【杀】当【闪】、【闪】当【杀】、【酒】当【桃】、【桃】当【酒】使用或打出',
  transformMap: TRANSFORM_MAP,
  promptTitle: '选择一张杀/闪/酒/桃转化',
  sourceCardFilter: (c: Card) =>
    c.name === '杀' || c.name === '闪' || c.name === '酒' || c.name === '桃',
  invalidSourceError: '该牌不能被界龙胆转化',
  directionMismatchError: () => '转化方向与原牌不符',
  activeWhen: (ctx: ActionContext, p: ViewPlayer) => {
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
  // 濒死求桃:界龙胆四向含 酒→桃,需在「请求回应」(桃/求桃)窗口声明替代回应
  extraAlternativeResponses: [['请求回应', '桃/求桃']],
};

export const { createSkill, onInit, onMount } = createLongdanSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
