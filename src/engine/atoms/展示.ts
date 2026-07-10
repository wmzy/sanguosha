// src/engine/atoms/展示.ts
// 展示:于吉「蛊惑」专用——翻开(展示)已扣置的牌,向所有人公开其真实身份。
//
// 设计(纯视图事件):
//   - apply:no-op。扣牌已在「扣牌」atom 中移入弃牌堆,展示只负责"公开身份",
//     不再移动牌(牌仍在弃牌堆)。后端始终知道牌身份(cardMap),展示只是把身份广播给所有视角。
//   - toViewEvents:全员可见 cardId + 牌面(ownerViews 空 → 所有人走 othersView)。
//   - applyView:no-op。弃牌堆在 view 中只投影数量,没有"已公开身份"的持久字段;
//     展示是一次性广播事件(动画/日志),不改变持久 view 状态。buildView 与 processedView 均不变 → 一致。
//
// 触发时机:有人质疑时翻开此牌(蛊惑 execute 在质疑分支调用)。
// 无人质疑时不展示——其他人永远不知道这张牌的真身(标准蛊惑规则)。
import type { AtomDefinition, ViewEventSplit, ViewEvent, Card } from '../types';
import { registerAtom } from '../atom';

export const 展示: AtomDefinition<{ player: number; cardId: string }> = {
  type: '展示',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply() {
    // 纯视图事件:牌已在弃牌堆,展示只广播身份,不改 state。
  },
  effect: { sound: 'flip', animation: 'flip', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const card: Card | undefined = state.cardMap[atom.cardId];
    const cardInfo = card ? { name: card.name, suit: card.suit, rank: card.rank } : null;
    const effect = { sound: 'flip' as const, animation: 'flip' as const, duration: 600 };
    // 全员可见(含扣牌者):ownerViews 空 → 所有人走 othersView
    const view: ViewEvent = {
      type: '展示',
      player: atom.player,
      cardId: atom.cardId,
      card: cardInfo,
      effect,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // no-op:弃牌堆只投影数量,无"已公开身份"持久字段。展示是广播事件,不改持久 view。
  },
  toViewLog(event) {
    const c = event.card as { suit: string; rank: string; name: string } | undefined;
    if (c) {
      return { player: event.player as number, text: `翻开蛊惑扣牌:${c.suit}${c.rank}(${c.name})` };
    }
    return { player: event.player as number, text: `翻开蛊惑扣牌` };
  },
};

registerAtom(展示);
