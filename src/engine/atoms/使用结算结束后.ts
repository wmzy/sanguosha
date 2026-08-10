// 使用结算结束后:使用结算后唯一时机(use.md 使用结算后)。
//
// 对应规则:"使用结算后有：使用结算结束后一个时机。
//   (1) 使用结算结束后：依次处理下列事件：
//     Ⅰ.若使用的不是装备牌，则将处理区里此牌对应的所有(剩余的)实体牌置入弃牌堆。
//     Ⅱ.奔袭①。"
//
// 事件标记型——apply 无副作用。牌移动(Ⅰ)由 runUseFlow 在发出本 atom 之前通过
// 移动牌 atom 完成(装备牌已装备、不在处理区;虚拟使用无实体牌,均自动跳过)。
// 本 atom 仅提供 before/after hook 注册点,after-hook 供奔袭①等技能挂载(Ⅱ)。
//
// 与 使用结算结束时 的区别:使用结算结束时 是逐目标时机(携带 target),
// 使用结算结束后 是所有目标结算完毕后的整体时机(无 target,携带 source+cardId)。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { getBeforeHooks, getAfterHooks } from '../core/skill';

export const 使用结算结束后: AtomDefinition<{ source: number; cardId: string }> = {
  type: '使用结算结束后',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    // 噪声抑制:无 before/after hook 时不产生视图事件(奔袭① 为 after-hook)
    if (
      getBeforeHooks(state, '使用结算结束后').length === 0 &&
      getAfterHooks(state, '使用结算结束后').length === 0
    ) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = {
      type: '使用结算结束后',
      source: atom.source,
      cardId: atom.cardId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

