// src/engine/atoms/move-timing.ts
// 移动牌编排时机 atom 定义(对齐 flow-redesign.md 模块 F / move.md):
//   - 移动到目标区域前 / 移动到目标区域后
//   全部为事件标记型:validate 恒通过、apply 无副作用,只提供 before/after hook 注册点。
//   由 src/engine/move-flow.ts 的编排函数 runMoveCardFlow 在实质移动牌(移动牌 atom)前后依次发出。
//
// before-hook modify to 的回传通道:
//   移动到目标区域前 的 before-hook 可 modify to(纵玄/章武② 改变目标区域,如改为武将牌上)。
//   其 afterApply 把折叠后的最终 to 写入 state.localVars[MOVE_TO_KEY],
//   runMoveCardFlow 据此读取修正后的目标区域,作为实质 移动牌 的 to。
//
// reason 透传:
//   时机 atom 携带 reason(失去原因:弃置/获得/给予 等),供连营/落英/屯田等「失去牌」
//   技能区分触发场景(如 reason==='弃置' && to.zone==='弃牌堆')。仅 runMoveCardFlow
//   迁移路径传递 reason;其余移动 reason 为 undefined。
//
// 噪声抑制:无 before hook 时标记型 atom 的 toViewEvents 返回 null(整个 atom 视图上 no-op),
// 与 damage-timing / life-timing / statechange-timing 一致。atom 本身仍走完整 pipeline
// (apply + after hooks),编排函数/测试可从 state.atomHistory 观察时序。
import type { AtomDefinition, GameState, MoveReason, ViewEventSplit, ViewEvent, ZoneLoc } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

// ── before-hook modify to 的回传通道 ─────────────────────────
// 移动到目标区域前 的 before-hook 可 modify to(纵玄/章武②);afterApply 把折叠后的
// 最终 to 写入 state.localVars[MOVE_TO_KEY],runMoveCardFlow 据此读取修正后的目标区域。
export const MOVE_TO_KEY = '__moveTo';

/** 移动时机 atom 的公共形状。 */
type MoveTimingAtom = {
  cardId: string;
  from: ZoneLoc;
  to: ZoneLoc;
  reason?: MoveReason;
};

/** 校验 cardId 存在(纯标记,不校验 from/to 合法性——编排函数前置保证)。 */
function validateMoveTiming(state: GameState, atom: MoveTimingAtom): string | null {
  if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
  return null;
}

/** 无 before-hook 时静默(no-op 视图),有 before-hook 时发通知事件。 */
function moveTimingView(state: GameState, type: string, atom: MoveTimingAtom): ViewEventSplit {
  if (getBeforeHooks(state, type).length === 0) {
    return { ownerViews: new Map(), othersView: null };
  }
  const view: ViewEvent = {
    type,
    cardId: atom.cardId,
    from: atom.from,
    to: atom.to,
    reason: atom.reason,
  };
  return { ownerViews: new Map(), othersView: view };
}

// ── 时机1:移动到目标区域前(纵玄/章武② 可改变目标区域) ───────
// before-hook 可 modify to(改变实质移动的目标区域)。afterApply 回写最终 to 供编排函数读取。
export const 移动到目标区域前: AtomDefinition<MoveTimingAtom> = {
  type: '移动到目标区域前',
  validate: validateMoveTiming,
  apply() {},
  async afterApply(state, atom) {
    state.localVars[MOVE_TO_KEY] = atom.to;
  },
  toViewEvents(state, atom) {
    return moveTimingView(state, '移动到目标区域前', atom);
  },
  applyView() {},
};

registerAtom(移动到目标区域前);

// ── 时机2:移动到目标区域后(连营/伤逝/落英/屯田 等「失去牌」技能) ─
// 纯标记,after-hook 触发失去牌类技能(按 reason 区分触发场景)。无 afterApply。
export const 移动到目标区域后: AtomDefinition<MoveTimingAtom> = {
  type: '移动到目标区域后',
  validate: validateMoveTiming,
  apply() {},
  toViewEvents(state, atom) {
    return moveTimingView(state, '移动到目标区域后', atom);
  },
  applyView() {},
};

registerAtom(移动到目标区域后);
