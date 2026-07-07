// src/engine/atoms/置创牌.ts
// 置创牌:周泰「不屈」专用——从牌堆顶翻一张牌作为"创"牌置于武将牌上。
//
// 设计:创牌存储于 player.vars['不屈/创牌'](cardId 列表,引擎权威)。
//   - apply: 弹出牌堆顶(末尾),追加到创牌列表,判定点数是否与已有创牌重复,
//            结果写入 localVars 供不屈 hook 读取决定存活/死亡。
//   - toViewEvents: 在 apply 之前调用(引擎管线约定),须从 pre-apply state 独立计算
//     创牌信息(牌堆顶 cardId + 重复判定),不依赖 apply 写入的 localVars。
//   - applyView: 仅同步 deckCount(牌堆-1)。创牌列表不投影到 GameView 字段
//     (buildView 不投影 player.vars['不屈/创牌'],故 applyView 也不动——保持一致)。
//
// 注意:牌堆顶 = zones.deck 末尾元素,与「摸牌」语义一致(slice(-n)/pop)。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 置创牌: AtomDefinition<{ player: number }> = {
  type: '置创牌',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (state.zones.deck.length === 0) return `牌堆为空,无法置创牌`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    // 弹出牌堆顶
    const cardId = state.zones.deck.pop()!;
    const card = state.cardMap[cardId];
    const rank = card?.rank;
    // 创牌列表(命名空间:不屈/创牌)
    const list = (player.vars['不屈/创牌'] as string[] | undefined) ?? [];
    // 判定点数是否与已有创牌重复(在追加前比较)
    const duplicate = rank !== undefined && list.some((id) => state.cardMap[id]?.rank === rank);
    list.push(cardId);
    player.vars['不屈/创牌'] = list;
    // 重复判定结果写入 localVars 供不屈 hook 读取(apply 完成后 hook 才读)
    state.localVars['不屈/重复'] = duplicate;
  },
  effect: { sound: 'draw', animation: 'flip', duration: 800 },
  toViewEvents(state, atom): ViewEventSplit {
    // ⚠ toViewEvents 在 apply 之前调用(state 尚未变更),须从 pre-apply state 独立计算:
    //   牌堆顶 = deck 末尾(apply 尚未 pop);重复判定对已有创牌列表(apply 尚未追加)
    const cardId = state.zones.deck[state.zones.deck.length - 1];
    const card = cardId ? state.cardMap[cardId] : undefined;
    const exist = (state.players[atom.player].vars['不屈/创牌'] as string[] | undefined) ?? [];
    const rank = card?.rank;
    const duplicate = rank !== undefined && exist.some((id) => state.cardMap[id]?.rank === rank);
    const view: ViewEvent = {
      type: '置创牌',
      player: atom.player,
      cardId,
      suit: card?.suit,
      rank,
      duplicate,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view: GameView, event) {
    // 创牌来自牌堆顶:牌堆-1(与 buildView 的 deckCount=deck.length 对齐)
    if (view.zones) {
      view.zones.deckCount = Math.max(0, view.zones.deckCount - 1);
    }
  },
  toViewLog(event) {
    const rank = event.rank as string | undefined;
    const suit = event.suit as string | undefined;
    const dup = event.duplicate as boolean | undefined;
    return {
      player: event.player as number,
      text: `不屈:翻开创牌 ${suit ?? ''}${rank ?? '?'}${dup ? '(点数重复!)' : ''}`,
    };
  },
};

registerAtom(置创牌);
