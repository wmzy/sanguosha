// 顺手牵羊 CardEffect — 普通锦囊·顺手牵羊的使用结算。
//
// resolve: 询问无懈可击 →（若未被抵消）弹选牌面板获得目标一张牌。
// target.kind='distance' dist=1: 距离 1 内的其他角色（奇才无距离限制）。

import type { Card } from '../types';
import type { ActionPrompt, GameView } from '../types';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';
import { runPickTargetCardPanel } from '../skills/选牌面板';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 顺手牵羊牌特有校验：距离 <= 1（奇才例外）、目标有牌、非自己 */
function canUseSnatch(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const target =
    (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
  if (target === undefined) return '目标不合法';
  if (target === ownerId) return '不能对自己使用';
  if (!state.players[target]?.alive) return '目标已死亡';
  const ignoreDistance = !!state.players[ownerId]?.tags.includes('奇才/无距离限制');
  if (!ignoreDistance && effectiveDistance(state, ownerId, target) > 1) return '距离太远';
  const p = state.players[target];
  if (!p) return '目标不合法';
  const hasCards =
    p.hand.length > 0 || Object.keys(p.equipment).length > 0 || p.pendingTricks.length > 0;
  if (!hasCards) return '目标无可获取的牌';
  return null;
}

/** 顺手牵羊的结算：选牌面板(获得) */
async function resolveSnatch(ctx: ResolveCtx): Promise<void> {
  const { state, source, target } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理
  const targetPlayer = state.players[target];
  if (targetPlayer) {
    await runPickTargetCardPanel(state, source, target, targetPlayer, {
      mode: 'obtain',
      requestType: '顺手牵羊_选牌',
      title: '选择获得的目标牌',
    });
  }
}

const snatchEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'distance', dist: 1, min: 1, max: 1 },
  canUse: canUseSnatch,
  resolve: resolveSnatch,
  // 选牌 respond：使用者从目标区域选一张牌（requestType='顺手牵羊_选牌'）。
  // 原逻辑来自 src/engine/skills/顺手牵羊.ts 的 respond registerAction。
  respond: {
    validate: (state, ownerId, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是选牌窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '顺手牵羊_选牌') return '当前不是选牌窗口';
      const zone = params.zone;
      if (zone === 'equipment' || zone === 'judge') {
        if (typeof params.cardId !== 'string') return 'cardId required';
      } else if (zone === 'hand') {
        if (typeof params.handIndex !== 'number') return 'handIndex required';
      } else {
        return 'zone required (equipment|judge|hand)';
      }
      return null;
    },
    execute: async (state, _ownerId, params) => {
      state.localVars['选牌/结果'] = {
        zone: params.zone,
        cardId: params.cardId ?? null,
        handIndex: params.handIndex ?? null,
      };
    },
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '顺手牵羊',
    cardFilter: { filter: (c: Card) => c.name === '顺手牵羊', min: 1, max: 1 },
    targetFilter: {
      min: 1,
      max: 1,
      filter: (view: GameView, t: number) =>
        viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
    },
  } as ActionPrompt,
  label: '顺手牵羊',
  style: 'primary',
};

registerCardEffect('顺手牵羊', snatchEffect);
