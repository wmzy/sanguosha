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
  apply(_state) {
    // 事件标记——拼点结果由后端 + 钩子处理
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
    if (typeof event.initiatorCard === 'string') cardIds.push(event.initiatorCard);
    if (typeof event.targetCard === 'string') cardIds.push(event.targetCard);
    if (view.zones) {
      // 两张拼点牌从处理区进入弃牌堆
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
