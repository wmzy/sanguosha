// src/engine/atoms/阶段间.ts
// 阶段间编排时机 atom 定义(对齐 flow-redesign.md 模块 J / game.md「X阶段与Y阶段间」时机):
//   - 阶段间
//   事件标记型:validate 恒通过、apply 无副作用,只提供 before/after hook 注册点。
//   由 src/engine/skills/回合管理.ts 的阶段结束 after-hook 在 阶段结束 与 阶段开始(next) 之间发出。
//
// before-hook cancel 语义(模块 J 决策):
//   cancel 阶段间 → 回合管理 after-hook 不再 apply 阶段开始(next),跳过下一阶段。
//   after-hook 后续的 `if (ctx.state.phase !== next) return;` 保护依然有效,
//   因此跳过的阶段不会执行其自动动作(摸牌/弃牌检查/出牌窗口/自动结束)。
//
// 噪声抑制:无 before hook 时标记型 atom 的 toViewEvents 返回 null(整个 atom 视图上 no-op),
// 与 damage-timing / move-timing / life-timing / statechange-timing 一致。atom 本身仍走完整
// pipeline(apply + after hooks),编排函数/测试可从 state.atomHistory 观察时序。
import type { AtomDefinition, GameState, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

/** 阶段间时机 atom 的形状。 */
type PhaseBetweenAtom = {
  player: number;
  from: string;
  to: string;
};

/** 校验 player 存在(纯标记,不校验 from/to 合法性——编排函数前置保证)。 */
function validatePhaseBetween(state: GameState, atom: PhaseBetweenAtom): string | null {
  if (!state.players[atom.player]) return `player ${atom.player} not found`;
  return null;
}

/** 无 before-hook 时静默(no-op 视图),有 before-hook 时发通知事件。 */
function phaseBetweenView(state: GameState, atom: PhaseBetweenAtom): ViewEventSplit {
  if (getBeforeHooks(state, '阶段间').length === 0) {
    return { ownerViews: new Map(), othersView: null };
  }
  const view: ViewEvent = {
    type: '阶段间',
    player: atom.player,
    from: atom.from,
    to: atom.to,
  };
  return { ownerViews: new Map(), othersView: view };
}

export const 阶段间: AtomDefinition<PhaseBetweenAtom> = {
  type: '阶段间',
  validate: validatePhaseBetween,
  apply() {},
  toViewEvents(state, atom) {
    return phaseBetweenView(state, atom);
  },
  applyView() {},
};

registerAtom(阶段间);
