// src/engine/atoms/展示.ts
// 展示:公开展示一张牌的牌面(牌不移动),向所有人广播。
//
// 使用方:火攻(目标展示手牌)/界火计(随机展示)/义绝/攻心/界强识/界潜袭/涯角/界直言/
// 蛊惑(翻开质疑扣牌)等一切"亮出手牌/扣牌给全员看"的操作。
//
// 设计(纯视图事件):
//   - apply:no-op。牌留在原区域(手牌/弃牌堆),展示只负责"公开牌面",
//     不移动牌。后端始终知道牌身份(cardMap),展示只是把身份广播给所有视角。
//   - toViewEvents:全员可见 cardId + 牌面(ownerViews 空 → 所有人走 othersView)。
//   - applyView:no-op。没有"已公开身份"的持久字段;展示是一次性广播事件(动画/日志),
//     不改变持久 view 状态。buildView 与 processedView 均不变 → 一致。
//
// 前端展示方式:展示类操作(火攻看目标手牌等)走「粘性展示卡」——
// 顶部中央常驻显示被展示牌,玩家可同时操作(不被阻塞);收起时机 = 本地动作提交、
// 新展示替换、或流程收尾广播「展示结束」(见 atoms/展示结束.ts,覆盖旁观/回放/超时路径)。
// duration 只控制入场翻转动画时长(翻入后停住,不淡出)。
import type { AtomDefinition, ViewEventSplit, ViewEvent, Card } from '../types';

/** 展示事件入场翻转入场动画时长(ms);粘性卡常驻至玩家操作,不由时长控制消失 */
const REVEAL_ENTER_MS = 700;

export const 展示: AtomDefinition<{ player: number; cardId: string }> = {
  type: '展示',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply() {
    // 纯视图事件:牌留在原区域,展示只广播牌面,不改 state。
  },
  effect: { sound: 'flip', animation: 'flip', duration: REVEAL_ENTER_MS },
  toViewEvents(state, atom): ViewEventSplit {
    const card: Card | undefined = state.cardMap[atom.cardId];
    const cardInfo = card ? { name: card.name, suit: card.suit, rank: card.rank } : null;
    const effect = { sound: 'flip' as const, animation: 'flip' as const, duration: REVEAL_ENTER_MS };
    // 全员可见:ownerViews 空 → 所有人走 othersView
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
    // no-op:无"已公开身份"持久字段。展示是广播事件,不改持久 view。
  },
  toViewLog(event) {
    const c = event.card as { suit: string; rank: string; name: string } | undefined;
    if (c) {
      return { player: event.player as number, text: `展示:${c.suit}${c.rank}(${c.name})` };
    }
    return { player: event.player as number, text: `展示` };
  },
};

