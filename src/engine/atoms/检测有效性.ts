// 检测有效性:使用结算开始时,检测此牌对目标是否有效。
// 对应规则"使用结算开始时:须检测此牌对目标的有效性"。
//
// 防具(仁王盾:黑杀无效)挂 before hook:判定无效则 cancel,调用方据此跳过该目标
// (不再询问闪、不造成伤害、不触发"被抵消"——因无效牌根本不会进入响应/生效阶段)。
//
// 通用时机:适用所有牌(杀/普通锦囊)。未来防具穿透规则(藤甲①等)可挂此处。
// 调用方约定:await applyAtom(检测有效性) 返回 false(被 cancel)=该目标无效,跳过。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 检测有效性: AtomDefinition<{ source: number; target: number; cardId: string }> = {
  type: '检测有效性',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {
    // 纯时机型 atom:有效性由 before hook 判定(cancel=无效),apply 无副作用。
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '检测有效性',
      source: atom.source,
      target: atom.target,
      cardId: atom.cardId,
    };
    return { ownerViews: new Map([[atom.target, view]]), othersView: view };
  },
  applyView() {
    // 无视图状态变更:有效性结果由后续 atom(询问闪/造成伤害)的 applyView 体现。
  },
  toViewLog(event) {
    return { player: event.target as number, text: `检测有效性` };
  },
};

registerAtom(检测有效性);
