// src/engine/atoms/武圣包装.ts
// 转化技包装:把手牌中的原卡"包装"为影子杀。
// - 单卡模式(武圣):1 张红色手牌 → 影子杀(shadowOf=原卡)
// - 双卡模式(丈八蛇矛):2 张手牌 → 1 张影子杀(shadowOf 留空)
//
// apply 负责:创建影子卡加入 cardMap + 替换/重组手牌。
// toViewEvents 实现信息分级:owner 看到完整牌面替换,他人只看到"使用转化"。
import type { AtomDefinition, Card, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

/** 单卡影子 id:${原id}#武圣 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#武圣`;
}

/** 双卡影子 id:${id1}#${id2}#丈八蛇矛 */
function shadowIdOfZhangba(id1: string, id2: string): string {
  return `${id1}#${id2}#丈八蛇矛`;
}

export const 武圣包装: AtomDefinition<{
  player: number;
  cardId: string;
  secondCardId?: string;
}> = {
  type: '武圣包装',
  validate(state, atom) {
    const self = state.players[atom.player];
    if (!self?.alive) return 'player not alive';
    if (atom.secondCardId) {
      // 丈八蛇矛:两张牌都必须在手中
      if (!self.hand.includes(atom.cardId) || !self.hand.includes(atom.secondCardId)) return 'cards not in hand';
      if (!state.cardMap[atom.cardId] || !state.cardMap[atom.secondCardId]) return 'cards not found';
    } else {
      if (!self.hand.includes(atom.cardId)) return 'card not in hand';
      if (!state.cardMap[atom.cardId]) return 'card not found';
    }
    return null;
  },
  apply(state, atom) {
    const self = state.players[atom.player];
    if (atom.secondCardId) {
      // 丈八蛇矛模式:2 张 → 1 张影子(无 shadowOf)
      const sId = shadowIdOfZhangba(atom.cardId, atom.secondCardId);
      const c1 = state.cardMap[atom.cardId];
      const shadow: Card = {
        id: sId,
        name: '杀',
        suit: c1.suit,
        rank: c1.rank,
        type: '基本牌',
      };
      state.cardMap[sId] = shadow;
      self.hand = self.hand.filter(c => c !== atom.cardId && c !== atom.secondCardId);
      self.hand.push(sId);
    } else {
      // 武圣模式:1 张 → 1 张影子(shadowOf=原卡)
      const sId = shadowIdOf(atom.cardId);
      const orig = state.cardMap[atom.cardId];
      const shadow: Card = {
        id: sId,
        name: '杀',
        suit: orig.suit,
        rank: orig.rank,
        type: '基本牌',
        shadowOf: atom.cardId,
      };
      state.cardMap[sId] = shadow;
      const idx = self.hand.indexOf(atom.cardId);
      if (idx >= 0) self.hand[idx] = sId;
    }
  },
  effect: { sound: 'transform', animation: 'flash', duration: 400 },
  toViewEvents(_state, atom): ViewEventSplit {
    const effect = { sound: 'transform' as const, animation: 'flash' as const, duration: 400 };
    // owner 看到完整替换(原卡→影子)
    const ownerView: ViewEvent = {
      type: '武圣包装',
      player: atom.player,
      cardId: atom.cardId,
      ...(atom.secondCardId ? { secondCardId: atom.secondCardId } : {}),
      effect,
    };
    // 他人只看到"使用转化",不暴露具体牌。dual 标记双卡模式供 applyView 更新 handCount
    const othersView: ViewEvent = {
      type: '武圣包装',
      player: atom.player,
      ...(atom.secondCardId ? { dual: true } : {}),
      effect,
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

    // 判断模式:dual 标记来自 othersView,secondCardId 来自 ownerView
    const isDual = !!(event as Record<string, unknown>).dual || !!secondCardId;
    if (isDual) {
      // 丈八蛇矛模式:2 张移除 + 1 张影子追加 → handCount - 1
      view.players[pi].handCount = Math.max(0, view.players[pi].handCount - 1);
      if (cardId && secondCardId && view.players[pi].hand) {
        const sId = shadowIdOfZhangba(cardId, secondCardId);
        const shadowCard = view.cardMap[sId];
        if (shadowCard) {
          view.players[pi].hand = view.players[pi].hand!.filter(
            c => c.id !== cardId && c.id !== secondCardId,
          );
          view.players[pi].hand!.push(shadowCard);
        }
      }
    } else if (cardId) {
      // 武圣模式:替换 → handCount 不变
      if (view.players[pi].hand) {
        const sId = shadowIdOf(cardId);
        const shadowCard = view.cardMap[sId];
        if (shadowCard) {
          const idx = view.players[pi].hand!.findIndex(c => c.id === cardId);
          if (idx >= 0) {
            view.players[pi].hand![idx] = shadowCard;
          }
        }
      }
    }
  },
  toViewLog(event) {
    return { player: event.player as number, text: '使用武圣转化出杀' };
  },
};

registerAtom(武圣包装);
