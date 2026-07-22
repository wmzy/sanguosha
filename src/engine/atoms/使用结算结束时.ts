// 使用结算结束时:使用结算中,牌对目标的结算完毕时触发(use.md 使用结算中 时机5)。
//
// 对应规则:"使用结算结束时:暂时没有作用。"
// 为完整性保留,供未来技能挂载。当前无 hook 消费。
// 事件标记型——apply 无副作用。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

export const 使用结算结束时: AtomDefinition<{ source: number; target: number; cardId: string }> = {
  type: '使用结算结束时',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '使用结算结束时').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = {
      type: '使用结算结束时',
      source: atom.source,
      target: atom.target,
      cardId: atom.cardId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(使用结算结束时);
