// 生效后:使用结算中,执行此牌的效果时触发(use.md 使用结算中 时机4)。
//
// 对应规则:"生效后:执行此牌的效果。"
// runUseFlow 在此 atom 之后调用 CardEffect.resolve——即牌的实际效果。
// 对杀:造成1点伤害;对桃:回复1点体力;对锦囊:各自的效果。
//
// 事件标记型——apply 无副作用,效果执行由 CardEffect.resolve 完成。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 生效后: AtomDefinition<{ source: number; target: number; cardId: string }> = {
  type: '生效后',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {
    // 纯时机型 atom:效果由 CardEffect.resolve 执行
  },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = state.cardMap[atom.cardId]?.name ?? atom.cardId;
    const view: ViewEvent = {
      type: '生效后',
      source: atom.source,
      target: atom.target,
      cardId: atom.cardId,
      cardName,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(生效后);
