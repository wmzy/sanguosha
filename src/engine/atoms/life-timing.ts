// src/engine/atoms/life-timing.ts
// 体力编排时机 atom 定义(对齐 flow-redesign.md 模块 M):
//   - 扣减体力:runDecreaseLifeFlow/runDamageFlow 的底层体力扣减 atom(实质副作用:扣 health)。
//     与 造成伤害 区分——后者保留为旧伤害入口,A 模块重构时由 runDamageFlow 取代。
//   - 时机标记型 atom(确定回复数值时/回复体力后/失去体力时/失去体力后/
//     扣减体力前/扣减体力时/扣减体力后/减上限后/加上限后):
//     validate 恒通过、apply 无副作用,只提供 before/after hook 注册点。
//     由 src/engine/life-flow.ts 的编排函数(runDecreaseLifeFlow/runRecoverLifeFlow/
//     runLoseLifeFlow/runSetMaxHealthFlow)在实质操作前后依次发出。
//
// 噪声抑制:无 before hook 时标记型 atom 的 toViewEvents 返回 null(整个 atom 视图上 no-op),
// 与 生效前/使用结算结束时 一致。atom 本身仍走完整 pipeline(apply + after hooks),
// 编排函数/测试可从 state.atomHistory 观察时序。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

// ── 扣减体力:底层实质 atom ──────────────────────────────────
// 仅扣减体力值(下限 0),不在此处触发濒死/死亡——由编排函数或系统规则现有 after-hook 决定。
// 注意:这是"扣减"语义,不做 alive 清理(与 造成伤害/失去体力 一致)。
export const 扣减体力: AtomDefinition<{ target: number; amount: number }> = {
  type: '扣减体力',
  validate(state, atom) {
    if (atom.amount < 0) return 'amount must be >= 0';
    const p = state.players[atom.target];
    if (!p) return `target ${atom.target} not found`;
    if (!p.alive) return `target ${atom.target} is dead`;
    return null;
  },
  apply(state, atom) {
    const target = state.players[atom.target];
    target.health = Math.max(0, target.health - atom.amount);
    // 不在此处置 alive——由 击杀 atom / 系统规则濒死流程负责。
  },
  effect: { sound: 'damage_physical', animation: 'shake', particles: 'blood', duration: 800 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '扣减体力',
      target: atom.target,
      amount: atom.amount,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view: GameView, event) {
    const pi = view.players.findIndex((p) => p.index === (event.target as number));
    if (pi < 0) return;
    const p = view.players[pi];
    p.health = Math.max(0, p.health - (event.amount as number));
    // alive 由 击杀 atom 的 applyView 更新,这里不提前设。
  },
  toViewLog(event) {
    return { player: event.target as number, text: `扣减 ${event.amount ?? 0} 点体力` };
  },
};

registerAtom(扣减体力);

// ── before-hook modify amount 的回传通道 ────────────────────
// 确定回复数值时 的 before-hook(如救援)可 modify amount;apply 把最终(被折叠后的)
// amount 写入 state.localVars[MODIFY_AMOUNT_KEY],runRecoverLifeFlow 据此读取修正后的回复值。
// 后续模块可优化为更通用的机制(见 flow-redesign.md),当前先用 localVars 简单传递。
export const MODIFY_AMOUNT_KEY = '__modifyAmount';

// ── 回复体力时机 ────────────────────────────────────────────
// 确定回复数值时:回复前确定数值(救援可修正)。apply 回写最终 amount 到 localVars。
export const 确定回复数值时: AtomDefinition<{
  target: number;
  amount: number;
  source?: number;
}> = {
  type: '确定回复数值时',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply(state, atom) {
    // before-hook modify 折叠后的 atom 最终 amount 回写,供 runRecoverLifeFlow 读取。
    state.localVars[MODIFY_AMOUNT_KEY] = atom.amount;
  },
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '确定回复数值时').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = {
      type: '确定回复数值时',
      target: atom.target,
      amount: atom.amount,
      source: atom.source,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(确定回复数值时);

// 回复体力后:回复完成后的时机(伤逝/淑慎/恩怨①)。纯标记。
export const 回复体力后: AtomDefinition<{ target: number; amount: number; source?: number }> = {
  type: '回复体力后',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '回复体力后').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = {
      type: '回复体力后',
      target: atom.target,
      amount: atom.amount,
      source: atom.source,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(回复体力后);

// ── 失去体力时机 ────────────────────────────────────────────
// 失去体力时:失去体力前(黄巾天兵符②)。纯标记。
export const 失去体力时: AtomDefinition<{ target: number; amount: number }> = {
  type: '失去体力时',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '失去体力时').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '失去体力时', target: atom.target, amount: atom.amount };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(失去体力时);

// 失去体力后:失去体力完成后(诈降)。纯标记。
export const 失去体力后: AtomDefinition<{ target: number; amount: number }> = {
  type: '失去体力后',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '失去体力后').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '失去体力后', target: atom.target, amount: atom.amount };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(失去体力后);

// ── 扣减体力时机(decreaselife.md,被 runDamageFlow 和 runLoseLifeFlow 共用)──
// 扣减体力前:酒诗②/连环条件检测/重置。纯标记。
export const 扣减体力前: AtomDefinition<{ target: number; amount: number }> = {
  type: '扣减体力前',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '扣减体力前').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '扣减体力前', target: atom.target, amount: atom.amount };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(扣减体力前);

// 扣减体力时:不屈。纯标记。
export const 扣减体力时: AtomDefinition<{ target: number; amount: number }> = {
  type: '扣减体力时',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '扣减体力时').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '扣减体力时', target: atom.target, amount: atom.amount };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(扣减体力时);

// 扣减体力后:伤逝。纯标记。
export const 扣减体力后: AtomDefinition<{ target: number; amount: number }> = {
  type: '扣减体力后',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '扣减体力后').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '扣减体力后', target: atom.target, amount: atom.amount };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(扣减体力后);

// ── 体力上限时机 ────────────────────────────────────────────
// 减上限后:runSetMaxHealthFlow 减上限(含同步降体力)后发出。纯标记。
export const 减上限后: AtomDefinition<{ player: number }> = {
  type: '减上限后',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '减上限后').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '减上限后', player: atom.player };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(减上限后);

// 加上限后:runSetMaxHealthFlow 加上限后发出。纯标记。
export const 加上限后: AtomDefinition<{ player: number }> = {
  type: '加上限后',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '加上限后').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '加上限后', player: atom.player };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(加上限后);
