// src/engine/atoms/移除延时锦囊.ts
// 移除延时锦囊:从玩家判定区移除指定延时锦囊
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';

export const 移除延时锦囊: AtomDefinition<{ player: number; trickName: string }> = {
  type: '移除延时锦囊',
  validate(state, atom) {
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state, atom) {
    state.players[atom.player].pendingTricks = state.players[atom.player].pendingTricks.filter(
      (t) => t.name !== atom.trickName,
    );
  },
  effect: { sound: 'flip', animation: 'fade', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    // 把匹配 trickName 的 PendingTrick 一并打包,便于前端匹配 cardId
    const trick = state.players[atom.player].pendingTricks.find((t) => t.name === atom.trickName);
    const view: ViewEvent = {
      type: '移除延时锦囊',
      player: atom.player,
      trickName: atom.trickName,
      ...(trick?.card?.id ? { cardId: trick.card.id } : {}),
    };
    return broadcast(view);
  },
  applyView(view, event) {
    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    const list = p.pendingTricks;
    if (!list || list.length === 0) return;
    const targetId = event.cardId as string | undefined;
    // PendingTrick.card 必有(types/state.ts),toViewEvents 恒打包匹配牌的 cardId,
    // 直接按 id 精确移除即可;不设按 trickName 反查 cardMap 的兜底——同名异 id 的
    // 牌会误删无关判定牌,事件缺 cardId(异常形状)时宁可不动作。
    if (targetId) {
      p.pendingTricks = list.filter((id) => id !== targetId);
    }
  },
};

