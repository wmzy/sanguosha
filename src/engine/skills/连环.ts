// 连环(庞统·主动技):你可以将一张梅花手牌当【铁索连环】使用或重铸。
//
// 分析:
//   类型:主动技(转化技/重铸) | 时机:出牌阶段
//
//   recycle(重铸):弃一张梅花手牌,摸一张牌。无次数限制。
//   transform(转化):preceding action,把梅花手牌通过「当作」atom 转化为影子「铁索连环」。
//     前端组合:preceding=[连环.transform] + 主 action=铁索连环.use。
//     铁索连环.use 零感知连环——它看到的是 cardMap 里的一张"铁索连环"。
//     五件套由 skillRuntime 工厂统一实现(模式参考 武圣.ts)。
//
// 共享导出:registerRecycleAction —— 「弃一张符合谓词的手牌,摸一张牌」的重铸注册
//   工厂,连环(梅花)/界连环(梅花)/界燕语(【杀】)三份同构注册的单一实现;
// createChainTransformOptions/mountChainRecycleAction —— 转化配置与重铸 defineAction
//   的构造工厂,连环/界连环两份同构声明的单一实现(仅 label/title/targetFilter 上限
//   不同,经参数注入)。界连环.ts 消费这些工厂。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { popFrame, pushFrame } from '../core/frame';
import { recastCard } from '../flows/recast';
import { registerAction } from '../core/skill';
import {
  engineCanPlayNow,
  mountTransformAction,
  registerTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';
import { defaultPlayActive } from '../rules/action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '连环',
    description: '你可以将一张梅花手牌当【铁索连环】使用或重铸',
  };
}

/** recycle(重铸)注册参数:三处同构注册(连环/界连环 的梅花、界燕语 的【杀】)
 *  的差异全部经此注入;validate 分支顺序与错误文案、pushFrame→recastCard→popFrame
 *  的 atom 序列逐字保留各版现状。 */
export interface RecycleActionOptions {
  /** 技能实例 id(registerAction 注册键:'连环'/'界连环'/'界燕语') */
  skillId: string;
  /** 技能拥有者座次 */
  ownerId: number;
  /** pushFrame 帧名(结算帧名,日志可见:'连环'/'界连环'/'界燕语') */
  frameName: string;
  /** 重铸牌判定(梅花:card.suit==='♣' / 界燕语:card.name==='杀') */
  isEligible: (card: Card | undefined) => boolean;
  /** validate 拒绝文案(逐字保留各版:'…手中梅花牌' / '…手中【杀】') */
  rejectMessage: string;
  /** 追加进结算帧 params 的额外字段(界燕语 的 recycle:true 日志标记;缺省无) */
  extraFrameParams?: Record<string, Json>;
}

/** 注册 recycle(重铸):出牌阶段弃一张符合 isEligible 的手牌,摸一张牌。
 *  历史行为:各版均不持有 unloader,本工厂同样不返回(保持卸载语义不变)。 */
export function registerRecycleAction(state: GameState, options: RecycleActionOptions): void {
  const { skillId, ownerId, frameName, isEligible, rejectMessage, extraFrameParams } = options;
  registerAction(
    state,
    skillId,
    ownerId,
    'recycle',
    (state: GameState, params: Record<string, Json>) => {
      const self = state.players[ownerId];
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const cardOk = isEligible(card);
      // 时机四合一(自己回合+出牌阶段+无阻塞+存活)由 engineCanPlayNow 统一判定
      const ok = engineCanPlayNow(state, ownerId) && cardInHand && cardOk;
      return ok ? null : rejectMessage;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      await pushFrame(state, frameName, from, { ...params, ...extraFrameParams });
      await recastCard(state, from, cardId);
      await popFrame(state);
    },
  );
}

/** transform 五件套工厂配置(梅花手牌 → 影子铁索连环)的构造工厂:
 *  连环/界连环两份配置仅 label/title/targetFilter 上限不同,经参数注入;
 *  validate 拒绝文案与 activeWhen 逐字保留各版现状。 */
export function createChainTransformOptions(
  displayName: string,
  maxTargets: number,
  titleSuffix = '',
): TransformActionOptions {
  return {
    outputName: '铁索连环',
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isClub = !!card && card.suit === '♣';
      if (!selfAlive) return '你已死亡';
      if (!cardIdOk || !cardInHand) return '牌不在手牌中';
      if (!isClub) return '只能将梅花牌当铁索连环';
      return null;
    },
    mount: {
      label: displayName,
      style: 'primary',
      prompt: {
        type: 'useCardAndTarget',
        title: `${displayName}:将一张梅花手牌当铁索连环使用${titleSuffix}`,
        cardFilter: { filter: (c: Card) => c.suit === '♣', min: 1, max: 1 },
        targetFilter: { min: 1, max: maxTargets, allowSelf: true },
      },
      activeWhen: (ctx) => {
        if (!defaultPlayActive(ctx)) return false;
        const p = ctx.view.players[ctx.perspectiveIdx];
        if (!p) return false;
        return p.hand?.some((c) => c.suit === '♣') ?? false;
      },
    },
  };
}

/** 挂载 recycle(重铸)的 defineAction 声明(前端入口):连环/界连环仅 label/title
 *  前缀不同,经 displayName 注入;activeWhen 逐字保留各版现状。 */
export function mountChainRecycleAction(api: FrontendAPI, displayName: string): void {
  api.defineAction('recycle', {
    label: `${displayName}·重铸`,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: `${displayName}:弃一张梅花手牌,摸一张牌`,
      cardFilter: { filter: (c: Card) => c.suit === '♣', min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return p.hand?.some((c) => c.suit === '♣') ?? false;
    },
  });
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── recycle:弃一张梅花手牌,摸一张牌(铁索连环的重铸效果;共享工厂)──
  registerRecycleAction(state, {
    skillId: skill.id,
    ownerId,
    frameName: '连环',
    isEligible: (card) => !!card && card.suit === '♣',
    rejectMessage: '现在不能重铸(需出牌阶段、手中梅花牌)',
  });

  // ── transform:梅花手牌 → 影子"铁索连环"(作为 preceding,主 action=铁索连环.use) ──
  // 五件套(影子 id 后缀=技能 id '连环'、当作、rollback、defineAction)由工厂统一实现;
  // 配置由 createChainTransformOptions 构造,validate 逐字保留原逐条件拒绝文案。
  registerTransformAction(state, skill.id, ownerId, createChainTransformOptions('连环', 2));

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  mountChainRecycleAction(api, '连环');
  // transform 声明由工厂统一构造(前端据此进入转化模式,组合 preceding=[连环.transform]
  // + 主 action=铁索连环.use(wrapperName='铁索连环'))。
  mountTransformAction(api, skill.id, createChainTransformOptions('连环', 2));
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
