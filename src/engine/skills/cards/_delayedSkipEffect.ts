// skills/cards/_delayedSkipEffect.ts — 延时锦囊「判定跳阶段」族工厂。
//
// 乐不思蜀/兵粮寸断 的 CardEffect 除参数外完全同构,差异全部收敛为工厂入参:
//   - failSuit 失败花色(乐不思蜀 ♥ / 兵粮寸断 ♣):判定为该花色 → 无效弃置,
//     否则加 skipTag 跳过 phase 阶段(阶段 before-hook 消费,见 use-card.ts)。
//   - withDistance 距离开关:兵粮寸断 true(目标须距离1内,奇才豁免),
//     乐不思蜀 false(无距离限制)。
//
// 生命周期:runUseFlow 置入判定区后暂停(delayed=true),判定阶段由
// resumeDelayedSettlement 恢复使用结算中,resolve 执行
// 「判定 → 读花色 → 加标签 → 移除延时锦囊」。
// 判定结果属于本次 resolve 调用,不受嵌套判定或天妒收牌影响。
// 闪电的判定结算语义完全不同(传递给下家而非弃置),不适用本工厂。
import type { Card, CardEffect } from '../../types';
import { applyAtom } from '../../core/apply';
import { runJudgeFlow } from '../../flows/judge';
import { firstTarget } from '../../util/skillRuntime';
import { distanceOneTargetFilter, distanceWithinOneOk } from './_distanceOne';

/** createDelayedSkipEffect 可选项。 */
export interface DelayedSkipOptions {
  /** 牌名(判定名 / 判定区查重 / 移除延时锦囊 / prompt 与 label)。 */
  trickName: string;
  /** 失败花色:判定为此花色 → 无效弃置,不跳阶段。 */
  failSuit: Card['suit'];
  /** 跳过阶段标签(加标签 atom 与 skipPhase 消费同一字面量)。 */
  skipTag: string;
  /** 判定非失败花色时跳过的阶段。 */
  phase: '出牌' | '摸牌';
  /** 是否要求目标距离1内(兵粮寸断 true / 乐不思蜀 false)。 */
  withDistance: boolean;
}

/** 乐不思蜀/兵粮寸断 的 CardEffect 工厂:canUse 守卫链 + 判定跳阶段 resolve
 *  + 延时锦囊放置(target/prompt 投影)单源。 */
export function createDelayedSkipEffect(opts: DelayedSkipOptions): CardEffect {
  const { trickName, failSuit, skipTag, phase, withDistance } = opts;
  return {
    timing: '出牌阶段',
    target: withDistance
      ? { kind: 'distance', dist: 1, min: 1, max: 1 }
      : { kind: 'other', min: 1, max: 1 },
    delayed: true,
    skipPhase: { tag: skipTag, phase },
    cancelledBy: { cardName: '无懈可击', broadcast: true },
    canUse(state, ownerId, params) {
      const target = firstTarget(params);
      if (target === undefined) return '目标不合法';
      if (target === ownerId) return '不能对自己使用';
      if (!state.players[target]?.alive) return '目标已死亡';
      // 距离检查:isLegalTarget 统一处理(含奇才豁免),canUse 也需检查具体目标
      if (
        withDistance &&
        !distanceWithinOneOk(state, ownerId, target, params.cardId as string | undefined)
      )
        return '距离太远';
      if (state.players[target].pendingTricks.some((t) => t.name === trickName))
        return `目标判定区已有${trickName}`;
      return null;
    },
    async resolve(ctx) {
      const { state, target } = ctx;
      const judgeCardId = await runJudgeFlow(state, target, trickName);
      const judgeCard = judgeCardId ? state.cardMap[judgeCardId] : undefined;
      if (judgeCard && judgeCard.suit !== failSuit) {
        // 非失败花色:加跳过阶段标签
        await applyAtom(state, { type: '加标签', player: target, tag: skipTag });
      }
      // 移除延时锦囊(失败花色时无效弃置,否则生效后弃置)
      await applyAtom(state, { type: '移除延时锦囊', player: target, trickName });
    },
    prompt: {
      type: 'useCardAndTarget',
      title: trickName,
      cardFilter: { filter: (c: Card) => c.name === trickName, min: 1, max: 1 },
      targetFilter: withDistance
        ? { min: 1, max: 1, filter: distanceOneTargetFilter }
        : { min: 1, max: 1 },
    },
    label: trickName,
    style: 'danger',
  };
}
