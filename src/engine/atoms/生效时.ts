// 生效时:使用结算中,牌未被抵消、确定将会生效时触发(use.md 使用结算中 时机3)。
//
// 对应规则:"生效时:若此牌未被抵消,确定将会生效。"
// 能发动的技能:谦逊。
//
// 仅在 生效前 未被 cancel 时到达(runUseFlow 在 生效前 返回 false 时跳过)。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

export const 生效时: AtomDefinition<{ source: number; target: number; cardId: string }> = {
  type: '生效时',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {
    // 纯时机型 atom
  },
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '生效时').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = {
      type: '生效时',
      source: atom.source,
      target: atom.target,
      cardId: atom.cardId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(生效时);
