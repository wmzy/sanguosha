// 顺手牵羊 CardEffect — 普通锦囊·顺手牵羊的使用结算。
//
// resolve: 询问无懈可击 →（若未被抵消）弹选牌面板获得目标一张牌。
// target.kind='distance' dist=1: 距离 1 内的其他角色（奇才无距离限制）。
// respond/resolve 走 cards/_pickPanel 共享实现（过河拆桥同构，obtain/discard 差异注入）。

import type { Card } from '../../types';
import { createPickPanelResolve, createPickPanelRespond } from './_pickPanel';
import { distanceOneTargetFilter, distanceWithinOneOk } from './_distanceOne';
import { hasObtainableCards } from '../../util/player-query';
import type { CardEffect } from '../../types';

const PICK_REQUEST_TYPE = '顺手牵羊_选牌';

function canUseSnatch(
  state: import('../../types').GameState,
  ownerId: number,
  params: Record<string, import('../../types').Json>,
): string | null {
  // dispatch 入口已归一 target/targets 两种形状(core/index.ts normalizeTargetShape)
  const targets = params.targets as number[] | undefined;
  if (!Array.isArray(targets) || targets.length === 0) return '目标不合法';
  const target = targets[0];
  if (target === ownerId) return '不能对自己使用';
  if (!state.players[target]?.alive) return '目标已死亡';
  // 距离检查:isLegalTarget 统一处理(含奇才豁免),canUse 也需检查具体目标
  if (!distanceWithinOneOk(state, ownerId, target, params.cardId as string | undefined))
    return '距离太远';
  const p = state.players[target];
  if (!hasObtainableCards(p)) return '目标无可获取的牌';
  return null;
}

export const snatchEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'distance', dist: 1, min: 1, max: 1 },
  canUse: canUseSnatch,
  resolve: createPickPanelResolve({
    mode: 'obtain',
    requestType: PICK_REQUEST_TYPE,
    title: '选择获得的目标牌',
  }),
  // 选牌 respond：使用者从目标区域选一张牌（requestType='顺手牵羊_选牌'）。
  // 原逻辑来自 src/engine/skills/顺手牵羊.ts 的 respond registerAction。
  // obtain 面板不启用装备候选校验:界奇才的防具/宝物保护仅约束弃置语义
  // (见 cards/_pickPanel 文件头)。
  respond: createPickPanelRespond({ requestType: PICK_REQUEST_TYPE }),
  prompt: {
    type: 'useCardAndTarget',
    title: '顺手牵羊',
    cardFilter: { filter: (c: Card) => c.name === '顺手牵羊', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1, filter: distanceOneTargetFilter },
  },
  label: '顺手牵羊',
  style: 'primary',
};
