// src/engine/atoms/移除延时锦囊.ts
// 移除延时锦囊:从玩家判定区移除指定延时锦囊
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 移除延时锦囊: AtomDefinition<{ player: number; trickName: string }> = {
  type: '移除延时锦囊',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    state.players[atom.player].pendingTricks = state.players[atom.player].pendingTricks.filter(
      (t) => t.name !== atom.trickName,
    );
  },
  effect: { sound: 'judge_remove', animation: 'fade', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    // 把匹配 trickName 的 PendingTrick 一并打包,便于前端匹配 cardId
    const trick = state.players[atom.player].pendingTricks.find((t) => t.name === atom.trickName);
    const view: ViewEvent = {
      type: '移除延时锦囊',
      player: atom.player,
      trickName: atom.trickName,
      ...(trick?.card?.id ? { cardId: trick.card.id } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const list = view.players[pi].pendingTricks;
    if (!list || list.length === 0) return;
    const targetId = event.cardId as string | undefined;
    const targetName = event.trickName as string | undefined;
    if (targetId) {
      // 直接按 cardId 移除
      view.players[pi].pendingTricks = list.filter((id) => id !== targetId);
      return;
    }
    if (!targetName) return;
    // 兜底:按 trickName 反查 cardMap 找匹配的 cardId(此时 cardMap 中 Card.name === trickName)
    const cardId = Object.keys(view.cardMap).find((id) => view.cardMap[id]?.name === targetName);
    if (cardId) {
      view.players[pi].pendingTricks = list.filter((id) => id !== cardId);
    } else {
      // 无法定位:保留 list 不动(下一次 toViewEvents 重建会刷新)
      view.players[pi].pendingTricks = [...list];
    }
  },
};

registerAtom(移除延时锦囊);
