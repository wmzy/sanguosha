// src/engine/atoms/拼点.ts
// 拼点:事件标记(拼点结果由后端 + 钩子处理)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 拼点: AtomDefinition<{
  initiator: number;
  target: number;
  initiatorCard: string;
  targetCard: string;
}> = {
  type: '拼点',
  validate(state, atom) {
    if (!state.players[atom.initiator]) return `initiator not found`;
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(state, atom) {
    // 两张拼点牌从结算帧牌区(frame.cards / 回退 processing)移入弃牌堆。
    // 调用方在 拼点 前已用「移动牌」把拼点牌移入处理区(frame.cards)。
    // 此处集中移动,与 applyView(processing→discard)对称;技能不再手动 splice/push。
    const frame = state.settlementStack[state.settlementStack.length - 1];
    const src = frame ? frame.cards : state.zones.processing;
    for (const id of [atom.initiatorCard, atom.targetCard]) {
      if (!id) continue;
      const idx = src.indexOf(id);
      if (idx >= 0) {
        src.splice(idx, 1);
        state.zones.discardPile.push(id);
      }
    }
  },
  effect: { sound: 'pindian', animation: 'flip', duration: 1500 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '拼点',
      initiator: atom.initiator,
      target: atom.target,
      initiatorCard: atom.initiatorCard,
      targetCard: atom.targetCard,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const cardIds: string[] = [];
    if (typeof event.initiatorCard === 'string' && event.initiatorCard) cardIds.push(event.initiatorCard);
    if (typeof event.targetCard === 'string' && event.targetCard) cardIds.push(event.targetCard);
    // 与 apply 对称:拼点牌从栈顶帧牌区(frame.cards)+ 兼容 processing 移出,进弃牌堆
    const f = view.settlementStack[view.settlementStack.length - 1];
    if (f) f.cards = f.cards.filter((id) => !cardIds.includes(id));
    if (view.zones) {
      if (view.zones.processing.length > 0) {
        view.zones.processing = view.zones.processing.filter((id) => !cardIds.includes(id));
      }
      view.zones.discardPileCount += cardIds.length;
    }
  },
  toViewLog(event) {
    return { player: event.initiator as number, text: '拼点' };
  },
};

registerAtom(拼点);
