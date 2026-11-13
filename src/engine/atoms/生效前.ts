// 生效前:使用结算中,牌对目标生效之前触发(use.md 使用结算中 时机2)。
//
// 对应规则:"生效前:可以对此牌进行响应。"
// 杀: handleSlashDodge 询间是否使用闪,发出闪的「生效前」atom。
// 无双/肉林在闪的「生效前」before-hook 中 cancel 第一次闪。
//
// before hook 返回 { kind: 'cancel' } = 此牌被抵消(闪生效),
// 调用方(runUseFlow)据此跳过 生效时/生效后,直接进入下一个目标。
//
// 事件标记型——apply 无副作用,只提供 hook 注册点。
// 噪声抑制:无 before hook 时整个 atom 是 no-op,不发 ViewEvent。
import type { AtomDefinition, ViewEventSplit } from '../types';
import { hookSilentView, requirePlayer } from './_helpers';

export const 生效前: AtomDefinition<{ source: number; target: number; cardId: string }> = {
  type: '生效前',
  validate(state, atom) {
    return requirePlayer(state, atom.target, 'target');
  },
  apply() {
    // 纯时机型 atom:响应交互(询问闪/被抵消)由 before hook 驱动,apply 无副作用。
  },
  toViewEvents(state, atom): ViewEventSplit {
    return hookSilentView(state, '生效前', () => ({
      type: '生效前',
      source: atom.source,
      target: atom.target,
      cardId: atom.cardId,
    }));
  },
  applyView() {
    // 无视图状态变更:响应结果由后续 atom(被抵消/造成伤害)的 applyView 体现。
  },
};

