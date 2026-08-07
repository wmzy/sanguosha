// 杀 CardEffect — 基本牌·杀的使用结算。
//
// 作用效果（use.md 生效后）：对目标角色造成 1 点伤害。
//
// 闪的抵消逻辑不在杀的 resolve 中——由 use-card.ts 的 handleSlashDodge 在「生效前」
// 时机循环询间使用闪，发出闪的「生效前」atom。无双/肉林在该 atom 的 before-hook 中
// cancel 第一次闪，实现"需两张闪"。
//
// onSettle 职责（runUseFlow 在结算完成后、popFrame 前调用）：
//   出杀次数累加（slash-quota）+ 回合用量 view 同步。

import type { Card, GameView, GameState, Json } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../index';
import { runDamageFlow } from '../damage-flow';
import { inAttackRange } from '../distance';
import { viewCanAttack } from '../viewDistance';
import { incSlashUsed, isSlashExempted, slashUsed } from '../slash-quota';
import { slashTargetMax } from '../slash-target';
import { defaultPlayActive, viewCanSlash } from '../action-active';
import {
  registerCardEffect,
  type CardEffect,
  type ResolveCtx,
} from '../card-effect/registry';

/** 杀的合法性追加检测：仅校验目标在攻击范围内。
 *  出杀次数限制（slash-quota）不由此处检查——由 validateCardUse.checkUsageLimit
 *  统一负责（mode='play' 强制，mode='forced' 跳过）。此处若重复检查 canSlash，
 *  会导致 forced 模式（借刀杀人/激将/挑衅/乱武 逼杀）被回合内出杀次数误挡。 */
function canUseSlash(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const cardId = params.cardId as string | undefined;
  // 攻击范围校验
  const targetsOk =
    Array.isArray(params.targets) &&
    (params.targets as number[]).every((t) => {
      if (state.players[t]?.alive !== true) return false;
      return inAttackRange(state, ownerId, t, cardId);
    });
  if (!targetsOk) return '目标不合法';
  // 目标数上限校验(权威):默认 1;方天画戟(最后一张手牌)/天义(拼点赢)/疠火(火杀)
  // 等通过 slashTargetMax 放宽。此前杀不限目标数,导致无方天画戟也能多目标。
  const targetsArr = Array.isArray(params.targets) ? (params.targets as number[]) : [];
  const maxTargets = slashTargetMax(state, ownerId, cardId);
  if (targetsArr.length > maxTargets) return `最多指定 ${maxTargets} 个目标`;
  return null;
}

/** 杀的生效后效果：对目标角色造成 1 点伤害 */
async function resolveSlash(ctx: ResolveCtx): Promise<void> {
  const { state, source, target, cardId } = ctx;
  const damageType = state.cardMap[cardId]?.damageType;
  await runDamageFlow(state, source, target, 1, cardId, damageType);
}

/** 杀的结算后回调：出杀次数累加 + view 同步 */
async function onSettleSlash(
  state: import('../types').GameState,
  source: number,
  cardId: string,
): Promise<void> {
  if (!isSlashExempted(state, source, cardId)) {
    incSlashUsed(state);
    await applyAtom(state, {
      type: '回合用量',
      player: source,
      key: '杀/usedCount',
      value: slashUsed(state),
    });
  }
}

const slashEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'inAttackRange', min: 1, max: 3 },
  canUse: canUseSlash,
  resolve: resolveSlash,
  onSettle: onSettleSlash,
  cancelledBy: { cardName: '闪', broadcast: false },
  // ── respond:被询问出杀(决斗/南蛮入侵等)——杀牌进处理区供调用方结算 ──
  respond: {
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
      // pending 必须是 询问杀 或 请求回应(挑衅/激将 等委托杀/respondKill)
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      const atomType = slot.atom.type;
      const reqType = (slot.atom as { requestType?: string }).requestType;
      const pendingMatches =
        atomType === '询问杀' ||
        (atomType === '请求回应' && reqType === '杀/respondKill');
      if (!pendingMatches) return '当前不是出杀的窗口';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (card?.name !== '杀') return '只能打出杀';
      }
      return null;
    },
    execute: async (state: GameState, ownerId: number, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return;
      // 杀牌进处理区,供调用方(决斗/南蛮入侵)检查处理区判断是否出了杀
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '处理区' },
      });
    },
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '出杀',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    targetFilter: {
      min: 1,
      max: 3,
      filter: (view: GameView, t: number) =>
        viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
    },
  } as ActionPrompt,
  respondPrompt: {
    type: 'useCard',
    title: '打出杀',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
  } as ActionPrompt,
  label: '杀',
  style: 'danger',
  activeWhen: (ctx) => defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx),
};

registerCardEffect('杀', slashEffect);
