// src/engine/atoms/武圣还原.ts
// rollback 路径:撤销武圣包装(删影子卡 + 手牌还原)。
// 主 action validate 失败时,引擎调用 preceding 的 rollback 来还原状态。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

/** 单卡影子 id:${原id}#武圣 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#武圣`;
}

/** 双卡影子 id:${id1}#${id2}#丈八蛇矛 */
function shadowIdOfZhangba(id1: string, id2: string): string {
  return `${id1}#${id2}#丈八蛇矛`;
}

export const 武圣还原: AtomDefinition<{
  player: number;
  cardId: string;
  secondCardId?: string;
}> = {
  type: '武圣还原',
  validate(_state, _atom) {
    return null;
  },
  apply(state, atom) {
    const self = state.players[atom.player];
    if (!self) return;
    if (atom.secondCardId) {
      // 丈八蛇矛还原:删影子 + 还原两张原卡
      const sId = shadowIdOfZhangba(atom.cardId, atom.secondCardId);
      delete state.cardMap[sId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand.splice(idx, 1);
      self.hand.push(atom.cardId, atom.secondCardId);
    } else {
      // 武圣还原:删影子 + 手牌里影子→原卡
      const sId = shadowIdOf(atom.cardId);
      delete state.cardMap[sId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = atom.cardId;
    }
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const ownerView: ViewEvent = {
      type: '武圣还原',
      player: atom.player,
      cardId: atom.cardId,
      ...(atom.secondCardId ? { secondCardId: atom.secondCardId } : {}),
    };
    const othersView: ViewEvent = {
      type: '武圣还原',
      player: atom.player,
    };
    return {
      ownerViews: new Map([[atom.player, ownerView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const playerIdx = event.player as number;
    const cardId = event.cardId as string | undefined;
    const secondCardId = event.secondCardId as string | undefined;
    const pi = view.players.findIndex(p => p.index === playerIdx);
    if (pi < 0) return;

    if (secondCardId && cardId) {
      // 丈八蛇矛还原:影子移除 + 2 张原卡追加 → handCount + 1
      view.players[pi].handCount += 1;
      if (view.players[pi].hand) {
        const sId = shadowIdOfZhangba(cardId, secondCardId);
        view.players[pi].hand = view.players[pi].hand!.filter(c => c.id !== sId);
        const c1 = view.cardMap[cardId];
        const c2 = view.cardMap[secondCardId];
        if (c1) view.players[pi].hand!.push(c1);
        if (c2) view.players[pi].hand!.push(c2);
      }
    } else if (cardId) {
      // 武圣还原:影子→原卡 → handCount 不变
      if (view.players[pi].hand) {
        const sId = shadowIdOf(cardId);
        const origCard = view.cardMap[cardId];
        if (origCard) {
          const idx = view.players[pi].hand!.findIndex(c => c.id === sId);
          if (idx >= 0) {
            view.players[pi].hand![idx] = origCard;
          }
        }
      }
    }
  },
  toViewLog() {
    return null;
  },
};

registerAtom(武圣还原);
