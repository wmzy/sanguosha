// src/engine/atoms/_timing.ts
// 标记型时机 atom 的共享工厂(下划线开头 = atoms 目录内部工具,不对外导出业务概念)。
//
// damage/judge/life/rank/statechange/move/death 七个 *-timing.ts 中的纯标记时机 atom
// 形状完全一致(四件套样板):
//   - validate:仅校验玩家/牌存在(纯标记语义,不校验存活/数值——编排函数前置保证);
//   - apply:无副作用(只为 before/after hook 提供注册点);
//   - toViewEvents:无 before-hook 时静默(hookSilentView),有则广播通知事件;
//   - applyView:no-op(实质变更由编排函数/实质 atom 负责)。
// 本工厂统一产出该四件套,消除逐文件手抄;带 afterApply 回写通道的时机
// (伤害族 DAMAGE_AMOUNT_KEY / 移动族 MOVE_TO_KEY / 判定族改判)以可选参数传入。
// 形状不符者保持手写:如 确定回复数值时 的 apply 有副作用、扣减体力 是实质 atom。
import type { AtomDefinition, GameState, ViewEvent } from '../types';
import { hookSilentView } from './_helpers';

/** 时机通知事件 payload 构造器:返回完整 ViewEvent(含 type 字段,保证广播 payload
 *  与收敛前逐字一致——type 由工厂透传,各时机族只填自身字段)。 */
export type TimingViewBuilder<T> = (type: string, atom: T) => ViewEvent;

/** 标记型时机 atom 工厂。
 *  @param type      atom type(同时透传给 payload 构造器,作为 ViewEvent.type)
 *  @param validate  存在性校验(纯标记语义)
 *  @param buildView 通知事件 payload;仅在存在 before-hook 时被调用并广播
 *  @param afterApply 可选「应用后」阶段:before-hook modify 的回传通道
 *                    (伤害族写 localVars、移动族写 MOVE_TO_KEY、判定族触发改判) */
export function makeTimingAtom<T>(
  type: string,
  validate: (state: GameState, atom: T) => string | null,
  buildView: TimingViewBuilder<T>,
  afterApply?: (state: GameState, atom: T) => Promise<void>,
): AtomDefinition<T> {
  return {
    type,
    validate,
    apply() {},
    ...(afterApply ? { afterApply } : {}),
    toViewEvents(state, atom) {
      return hookSilentView(state, type, () => buildView(type, atom));
    },
    applyView() {},
  };
}
