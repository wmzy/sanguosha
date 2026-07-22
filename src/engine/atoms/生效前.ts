// 生效前:使用结算中,牌对目标生效之前触发(use.md 使用结算中 时机2)。
//
// 对应规则:"生效前:可以对此牌进行响应。"
// 闪 skill 挂 before hook:成为杀的目标时,询问是否出闪。
// 无双①/肉林① 作为"进行响应时能产生影响的技能",在闪 hook 内通过
// PostDodgeAskHook 消耗第一张闪并追加第二次询问。
//
// before hook 返回 { kind: 'cancel' } = 此牌被抵消(闪生效),
// 调用方(runUseFlow)据此跳过 生效时/生效后,直接进入下一个目标。
//
// 事件标记型——apply 无副作用,只提供 hook 注册点。
// 噪声抑制:无 before hook 时整个 atom 是 no-op,不发 ViewEvent。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

export const 生效前: AtomDefinition<{ source: number; target: number; cardId: string }> = {
  type: '生效前',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {
    // 纯时机型 atom:响应交互(询问闪/被抵消)由 before hook 驱动,apply 无副作用。
  },
  toViewEvents(state, atom): ViewEventSplit {
    // 无 before hook 时抑制:整个 atom 是 no-op
    if (getBeforeHooks(state, '生效前').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = {
      type: '生效前',
      source: atom.source,
      target: atom.target,
      cardId: atom.cardId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 无视图状态变更:响应结果由后续 atom(被抵消/造成伤害)的 applyView 体现。
  },
};

registerAtom(生效前);
