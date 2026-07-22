// 过河拆桥 CardEffect — 普通锦囊·过河拆桥的使用结算。
//
// resolve: 询问无懈可击 →（若未被抵消）弹选牌面板弃置目标一张牌。
// target.kind='other': 任意其他角色（无距离限制）。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { 询问无懈可击 } from '../无懈可击';
import { runPickTargetCardPanel } from '../skills/选牌面板';
import { QICAI_PROTECTED_SLOTS } from '../skills/界奇才';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 过河拆桥牌特有校验：目标有牌（奇才保护槽位）、非自己 */
function canUseDismantle(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const targets = params.targets as number[] | undefined;
  if (!Array.isArray(targets) || targets.length === 0) return '目标不合法';
  for (const t of targets) {
    if (t === ownerId) return '不能对自己使用';
    if (!state.players[t]?.alive) return '目标已死亡';
    const p = state.players[t];
    if (!p) return '目标不合法';
    const discardableEquip = Object.keys(p.equipment).filter((slot) => {
      const protectTag = QICAI_PROTECTED_SLOTS[slot];
      return !protectTag || !p.tags.includes(protectTag);
    });
    const hasCards =
      p.hand.length > 0 || discardableEquip.length > 0 || p.pendingTricks.length > 0;
    if (!hasCards) return '目标无可弃置的牌';
  }
  return null;
}

/** 过河拆桥的结算：无懈 → 选牌面板(弃置) */
async function resolveDismantle(ctx: ResolveCtx): Promise<void> {
  const { state, source, target } = ctx;
  const cancelled = await 询问无懈可击(state, target);
  if (!cancelled) {
    const targetPlayer = state.players[target];
    if (targetPlayer) {
      await runPickTargetCardPanel(state, source, target, targetPlayer, {
        mode: 'discard',
        requestType: '过河拆桥_选牌',
        title: '选择弃置的目标牌',
      });
    }
  }
}

const dismantleEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'other', min: 1, max: 1 },
  canUse: canUseDismantle,
  resolve: resolveDismantle,
  prompt: {
    type: 'useCardAndTarget',
    title: '过河拆桥',
    cardFilter: { filter: (c: Card) => c.name === '过河拆桥', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  } as ActionPrompt,
  label: '过河拆桥',
  style: 'primary',
};

registerCardEffect('过河拆桥', dismantleEffect);
