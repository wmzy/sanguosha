// 界连环(界庞统·主动技):你可以将一张梅花手牌当【铁索连环】使用或重铸。
//   你使用【铁索连环】可以多指定一个目标(即至多 3 名角色)。
//
// OL 官方(hero)逐字:
//   "你可以将一张梅花牌当【铁索连环】使用或重铸。你使用【铁索连环】可以多指定一个目标。"
//
// 与标连环区别:
//   - 标版仅基础转化/重铸,铁索连环目标上限 2(由标版铁索连环.use 校验)。
//   - 界版新增"使用铁索连环可以多指定一个目标",目标上限 3。
//   - 独立界版技能文件,不修改标连环/标铁索连环。影子卡 id 键 '界连环'(与标连环隔离)。
//
// 模型(组合 action + 覆盖):
//   ① transform action(preceding,界连环.transform):梅花手牌 → 影子铁索连环。
//      前端组合:preceding=[界连环.transform] + 主 action=铁索连环.use。
//   ② recycle action(界连环.recycle):弃一张梅花手牌,摸一张牌(铁索连环的重铸效果)。
//   ③ use action(覆盖铁索连环.use,仅本座次):界版铁索连环结算,目标上限 3(标版 2)。
//      覆盖保证:界庞统以任何来源的【铁索连环】(界连环转化或实际铁索连环牌)均走界版结算。
//      其他座次的铁索连环仍走标版(由标铁索连环 card skill 注册)。
//
// 覆盖机制:铁索连环在 DEFAULT_SKILLS 中,先实例化标版铁索连环.use;界连环.onInit 后实例化,
//   registerAction('铁索连环', ownerId, 'use', ...) 覆盖标版注册(state-bound 注册表 Map.set 覆盖)。
//   "你使用【铁索连环】可以多指定一个目标" 为角色锁定属性,凡本座次使用铁索连环均走界版,
//   符合官方语义。
//
// 模式参考:标连环.ts(转化/重铸)、界火计.ts(覆盖 DEFAULT_SKILLS 中 card skill 的 use)。
import type { FrontendAPI, GameState, Skill, SkillModule } from '../types';
import { registerAction } from '../core/skill';
import { mountTransformAction, registerTransformAction } from '../util/skillRuntime';
import {
  createChainTransformOptions,
  mountChainRecycleAction,
  registerRecycleAction,
} from './连环';
import { makeChainUseHandlers } from './cards/铁索连环';

/** 界庞统使用铁索连环的目标上限(标版 2,界版 +1 = 3) */
const MAX_TARGETS = 3;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界连环',
    description:
      '你可以将一张梅花牌当【铁索连环】使用或重铸;你使用【铁索连环】可以多指定一个目标(至多3名)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── recycle:弃一张梅花手牌,摸一张牌(铁索连环的重铸效果;共享工厂见 连环.ts)──
  registerRecycleAction(state, {
    skillId: skill.id,
    ownerId,
    frameName: '界连环',
    isEligible: (card) => !!card && card.suit === '♣',
    rejectMessage: '现在不能重铸(需出牌阶段、手中梅花牌)',
  });

  // ── transform:梅花手牌 → 影子"铁索连环"(作为 preceding,主 action=铁索连环.use) ──
  // 五件套由 skillRuntime 工厂统一实现;影子卡 id 后缀=技能 id '界连环'(与标连环
  // `${原id}#连环` 隔离);配置由 连环.ts 的 createChainTransformOptions 构造
  // (validate 拒绝文案逐字共享,仅目标上限/标题后缀不同)。
  registerTransformAction(
    state,
    skill.id,
    ownerId,
    createChainTransformOptions('界连环', MAX_TARGETS, '(至多3名目标)'),
  );

  // ─── use action:覆盖标版铁索连环.use,本座次走界版结算(目标上限 3) ───
  // 铁索连环在 DEFAULT_SKILLS 中先实例化标版铁索连环.use;此处 registerAction 覆盖之(同 key 覆盖)。
  // 仅影响本座次(界庞统),其他座次的铁索连环仍走标版。
  // 结算(帧/无懈询问参数/横置切换/异常清理)与标版逐字相同,由 cards/铁索连环.ts 的
  // makeChainUseHandlers 共享;与标版唯一差异:targets.length 上限由 2 提升至 3
  // (官方"多指定一个目标")。
  const chainUse = makeChainUseHandlers(ownerId, MAX_TARGETS);
  registerAction(state, '铁索连环', ownerId, 'use', chainUse.validate, chainUse.execute);

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  mountChainRecycleAction(api, '界连环');
  // transform 声明由工厂统一构造(前端据此进入转化模式,组合 preceding=[界连环.transform]
  // + 主 action=铁索连环.use(wrapperName='铁索连环'))。
  mountTransformAction(
    api,
    skill.id,
    createChainTransformOptions('界连环', MAX_TARGETS, '(至多3名目标)'),
  );
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
