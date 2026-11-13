// 使用结算结束时:使用结算中,牌对目标的结算完毕时触发(use.md 使用结算中 时机5)。
//
// 对应规则:"使用结算结束时:暂时没有作用。"
// 为完整性保留,供未来技能挂载。当前无 hook 消费。
// 事件标记型——apply 无副作用。
import type { AtomDefinition, ViewEventSplit } from '../types';
import { hookSilentView, requirePlayer } from './_helpers';

export const 使用结算结束时: AtomDefinition<{ source: number; target: number; cardId: string }> = {
  type: '使用结算结束时',
  validate(state, atom) {
    return requirePlayer(state, atom.target, 'target');
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    return hookSilentView(state, '使用结算结束时', () => ({
      type: '使用结算结束时',
      source: atom.source,
      target: atom.target,
      cardId: atom.cardId,
    }));
  },
  applyView() {},
};

