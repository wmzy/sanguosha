// 断粮(徐晃·主动技/转化):出牌阶段,你可以将一张黑色的基本牌或黑色装备牌
//   当【兵粮寸断】使用;你对手牌数不小于你的角色使用【兵粮寸断】无距离限制。
//
// 实现策略(独立 use):
//   兵粮寸断.use 的距离校验硬编码 effectiveDistance<=1,无法承载"无距离限制"的放松规则。
//   且断粮转化的卡不是"兵粮寸断"卡(而是黑色基本/装备牌)。故采用独立 use action:
//   validate 校验黑色基本/装备牌 + 放松距离;execute 直接放置 name='兵粮寸断' 的延时锦囊。
//   判定/跳过摸牌阶段的效果由现有 兵粮寸断.ts 的 hooks 处理(它们只认 pendingTricks.name)。
//   无次数限制(描述明确)。
//
// 距离规则:
//   - 默认:目标须在距离 1 以内(与兵粮寸断一致)
//   - 放松判据按版本注入(标:目标手牌数 >= 徐晃手牌数 / 界:本回合未造成过伤害)
//
// 本文件同时导出 createDuanliangSkill 工厂(断粮族共享实现),界断粮 复用之,
// 仅注入 距离放松判据(引擎侧 + view 侧同源)与本回合伤害追踪 hook 差异。
import type { Card, GameView, FrontendAPI, GameState, Json, Skill } from '../types';
import { popFrame, pushFrame } from '../core/frame';
import { placeDelayedTrickTransform } from './_delayedTrickTransform';
import { defaultPlayActive } from '../rules/action-active';
import { registerAction } from '../core/skill';
import { engineCanPlayNow } from '../util/skillRuntime';
import { effectiveDistance } from '../rules/distance';
import { viewEffectiveDistance } from '../rules/viewDistance';

const TRICK_NAME = '兵粮寸断';

/** 断粮可用牌:黑色(♠/♣)的基本牌或装备牌 */
function isDuanliangCard(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.color !== '黑') return false;
  return card.type === '基本牌' || card.type === '装备牌';
}

/** 断粮族差异参数。 */
export interface DuanliangOptions {
  /** 技能 id(标 '断粮' / 界 '界断粮'):Skill.name、结算帧标签、validate 收尾文案、按钮 label */
  skillId: string;
  description: string;
  mountTitle: string;
  /** 引擎侧距离放松判据(true = 对该目标无距离限制) */
  rangeRelaxed: (state: GameState, ownerId: number, target: number) => boolean;
  /** view 侧距离放松判据(targetFilter 用,与 rangeRelaxed 同源投影) */
  rangeRelaxedView: (view: GameView, me: number, t: number) => boolean;
  /** 界版附加注册(造成伤害 after-hook 标记本回合已伤害);unloader 由调用方自理 */
  extraInit?: (state: GameState, skillId: string, ownerId: number) => void;
}

/** 断粮族共享实现:转化范围/校验/execute/onMount 逐字一致,仅距离放松判据不同。 */
export function createDuanliangSkill(opts: DuanliangOptions) {
  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.skillId,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;
    opts.extraInit?.(state, skill.id, ownerId);

    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (state: GameState, params: Record<string, Json>): string | null => {
        const self = state.players[ownerId];
        if (!self?.alive) return '玩家不存在或已死亡';
        if (typeof params.cardId !== 'string') return '需要选择一张牌';
        if (typeof params.target !== 'number') return '需要选择目标';
        if (!self.hand.includes(params.cardId)) return '牌不在手牌中';
        if (!isDuanliangCard(state.cardMap[params.cardId]))
          return '需要黑色基本牌或装备牌';
        const target = params.target;
        if (target === ownerId) return '不能对自己使用';
        const targetPlayer = state.players[target];
        if (!targetPlayer?.alive) return '目标不存在或已死亡';
        // 目标判定区已有兵粮寸断时不可使用(与兵粮寸断自身规则一致)
        if (targetPlayer.pendingTricks.some((t) => t.name === TRICK_NAME))
          return '目标判定区已有兵粮寸断';

        // 距离规则:版本各自放松判据,否则须 ≤1
        const inRange =
          opts.rangeRelaxed(state, ownerId, target) ||
          effectiveDistance(state, ownerId, target) <= 1;

        // 时机(自己回合+出牌阶段+无阻塞,存活已由上方早退校验)由 engineCanPlayNow 统一判定
        const ok = engineCanPlayNow(state, ownerId) && inRange;
        return ok ? null : `${opts.skillId}使用条件不满足`;
      },
      async (state: GameState, params: Record<string, Json>): Promise<void> => {
        const from = ownerId;
        const cardId = params.cardId as string;
        const target = params.target as number;
        await pushFrame(state, opts.skillId, from, { ...params });

        // 放置延时锦囊(打出进处理区 → 添加 → 弃牌堆;判定/跳过摸牌 hooks 见 兵粮寸断.ts)
        await placeDelayedTrickTransform(state, {
          from,
          target,
          cardId,
          trickName: TRICK_NAME,
          fallback: { suit: '♣', color: '黑', rank: 'A' },
        });

        await popFrame(state);
      },
    );

    return () => {};
  }

  function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
    api.defineAction('use', {
      label: opts.skillId,
      style: 'danger',
      prompt: {
        type: 'useCardAndTarget',
        title: opts.mountTitle,
        cardFilter: { filter: (c: Card) => isDuanliangCard(c), min: 1, max: 1 },
        targetFilter: {
          min: 1,
          max: 1,
          // 距离放松:版本各自判据(与引擎 rangeRelaxed 同源投影),否则 ≤1
          filter: (view: GameView, t: number) => {
            const me = view.currentPlayerIndex;
            if (t === me) return false;
            const tp = view.players[t];
            if (!tp) return false;
            if (tp.alive === false) return false;
            if (opts.rangeRelaxedView(view, me, t)) return true; // 无距离限制
            return viewEffectiveDistance(view.players, me, t) <= 1;
          },
        },
      },
      activeWhen: (ctx) => {
        if (!defaultPlayActive(ctx)) return false;
        const p = ctx.view.players[ctx.perspectiveIdx];
        if (!p) return false;
        return (p.hand?.some((c) => isDuanliangCard(c)) ?? false);
      },
    });
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: DuanliangOptions = {
  skillId: '断粮',
  description: '将一张黑色基本牌或装备牌当【兵粮寸断】使用;对手牌数不小于你的角色无距离限制',
  mountTitle: '断粮:将黑色基本牌/装备牌当兵粮寸断使用',
  // 距离放松:目标手牌数 >= 自己 → 无限制
  rangeRelaxed: (state, ownerId, target) =>
    (state.players[target]?.hand.length ?? 0) >= (state.players[ownerId]?.hand.length ?? 0),
  rangeRelaxedView: (view, me, t) => {
    const myHand = view.players[me]?.handCount ?? 0;
    return (view.players[t]?.handCount ?? 0) >= myHand;
  },
};

export const { createSkill, onInit, onMount } = createDuanliangSkill(OPTIONS);
