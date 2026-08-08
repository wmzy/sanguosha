// src/engine/atoms/置创牌.ts
// 置创牌(通用「翻牌置标记」atom):从牌堆顶翻一张牌置于 player.vars[varsKey] 列表,
// 点数与已有牌重复则移去(进弃牌堆)。
//
// 通用化:vars key 由调用方参数指定,atom 自身不绑定任何具体技能。
//   - player:翻牌的目标玩家(标记置于其武将牌上)
//   - varsKey:创牌列表(去重比较的基准)存储于 player.vars 的键名(引擎权威,cardId 列表)
//   - resultKey:重复判定结果(boolean)写入的 localVars 键名,供调用方技能读取
//
// 设计:
//   - apply: 弹出牌堆顶(末尾),判定点数是否与 varsKey 列表中已有牌重复:
//            · 不重复 → 追加到 varsKey 列表;
//            · 重复   → 移去此牌(进弃牌堆,不留武将牌)。
//            重复判定结果写入 localVars[resultKey] 供调用方 hook 读取。
//   - toViewEvents: 在 apply 之前调用(引擎管线约定),须从 pre-apply state 独立计算
//     创牌信息(牌堆顶 cardId + 重复判定),不依赖 apply 写入的 localVars。
//   - applyView: 同步 deckCount(牌堆-1);重复时同步 discardPileCount(+1)。
//     创牌列表不投影到 GameView 字段(buildView 不投影 player.vars[varsKey],
//     故 applyView 不动它——保持一致)。
//
// 注意:牌堆顶 = zones.deck 末尾元素,与「摸牌」语义一致(slice(-n)/pop)。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../core/atom';

export const 置创牌: AtomDefinition<{
  player: number;
  varsKey: string;
  resultKey: string;
}> = {
  type: '置创牌',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (state.zones.deck.length === 0) return `牌堆为空,无法置创牌`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const { varsKey, resultKey } = atom;
    // 弹出牌堆顶
    const cardId = state.zones.deck.pop()!;
    const card = state.cardMap[cardId];
    const rank = card?.rank;
    // 创牌列表(键名由调用方指定)
    const list = (player.vars[varsKey] as string[] | undefined) ?? [];
    // 判定点数是否与已有创牌重复(在追加前比较)
    const duplicate = rank !== undefined && list.some((id) => state.cardMap[id]?.rank === rank);
    if (duplicate) {
      // 点数重复:移去此牌(进弃牌堆),不置于武将牌上
      state.zones.discardPile.push(cardId);
    } else {
      list.push(cardId);
      player.vars[varsKey] = list;
    }
    // 重复判定结果写入 localVars 供调用方 hook 读取(apply 完成后 hook 才读)
    state.localVars[resultKey] = duplicate;
  },
  effect: { sound: 'flip', animation: 'flip', duration: 800 },
  toViewEvents(state, atom): ViewEventSplit {
    // ⚠ toViewEvents 在 apply 之前调用(state 尚未变更),须从 pre-apply state 独立计算:
    //   牌堆顶 = deck 末尾(apply 尚未 pop);重复判定对已有创牌列表(apply 尚未追加)
    const { varsKey } = atom;
    const cardId = state.zones.deck[state.zones.deck.length - 1];
    const card = cardId ? state.cardMap[cardId] : undefined;
    const exist = (state.players[atom.player].vars[varsKey] as string[] | undefined) ?? [];
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
      // 重复时此牌进弃牌堆:弃牌堆+1(与 buildView 的 discardPileCount 对齐)
      if (event.duplicate) {
        view.zones.discardPileCount += 1;
      }
    }
  },
  toViewLog(event) {
    const rank = event.rank as string | undefined;
    const suit = event.suit as string | undefined;
    const dup = event.duplicate as boolean | undefined;
    return {
      player: event.player as number,
      text: `翻开创牌 ${suit ?? ''}${rank ?? '?'}${dup ? '(点数重复!)' : ''}`,
    };
  },
};

registerAtom(置创牌);
