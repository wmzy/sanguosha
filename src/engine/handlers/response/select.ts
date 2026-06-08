// engine/handlers/response/select.ts — selectCard 窗口（过河拆桥/顺手牵羊选牌）
//
// 出牌者从目标手牌选 1 张牌：steal 模式移到出牌者手牌，discard 模式移入弃牌堆。

import type { GameState, GameAction, EngineResult, Atom, PendingSelectCard } from '../../types';
import { getPlayer } from '../../state';
import { applyAtoms } from '../../atom';

export function resolveSelectCard(
  state: GameState,
  action: GameAction,
  pending: PendingSelectCard,
): EngineResult {
  if (action.type !== '打出') {
    return { state, logEntries: [], error: '选牌需要 respond 动作' };
  }
  if (action.player !== pending.player) {
    return { state, logEntries: [], error: '只有出牌者可以选择' };
  }

  const selectedIds = action.cardIds ?? (action.cardId ? [action.cardId] : []);
  if (selectedIds.length < pending.min || selectedIds.length > pending.max) {
    return { state, logEntries: [], error: '选择的卡牌数量不符' };
  }

  // 校验所选卡牌确实在目标手中
  const targetPlayer = getPlayer(state, pending.target);
  for (const cardId of selectedIds) {
    if (!targetPlayer.hand.includes(cardId)) {
      return { state, logEntries: [], error: '所选卡牌不在目标手牌中' };
    }
  }

  // 执行效果：注：源牌（锦囊牌）已在 handleTrickCard 中移入弃牌堆，此处不再重复移动
  const atoms: Atom[] = [];

  if (pending.mode === '获得') {
    atoms.push(...selectedIds.map(cardId => ({
      type: '移动牌' as const,
      cardId,
      from: { zone: '手牌' as const, player: pending.target },
      to: { zone: '手牌' as const, player: pending.player },
    })));
  } else {
    atoms.push(...selectedIds.map(cardId => ({
      type: '移动牌' as const,
      cardId,
      from: { zone: '手牌' as const, player: pending.target },
      to: { zone: '弃牌堆' as const },
    })));
  }

  atoms.push({ type: '弹出待定' });
  const result = applyAtoms(state, atoms);
  return { state: result.state, logEntries: result.logEntries };
}
