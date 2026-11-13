// src/engine/atoms/失去体力.ts
// 失去体力:target 玩家失去 amount 体力(非伤害——不触发反馈/奸雄等伤害技)。
// 与 造成伤害时 一致:只扣体力,不在此处置 alive——体力归零时由 系统规则 的
// '失去体力' after-hook 触发 濒死(求桃)流程,无人救援才由 系统处理牌 置 alive=false。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';

export const 失去体力: AtomDefinition<{ target: number; amount: number }> = {
  type: '失去体力',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const err = requirePlayer(state, atom.target, 'target');
    if (err) return err;
    if (!state.players[atom.target].alive) return `target is dead`;
    return null;
  },
  apply(state, atom) {
    const target = state.players[atom.target];
    target.health = target.health - atom.amount;
    // 不在此处置 alive——与 造成伤害时 一致,由 系统规则 after-hook 触发濒死流程,
    // 无人救援时由 death-flow 的 系统处理牌 负责。
  },
  effect: { sound: 'lose_health', animation: 'shake', duration: 800 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '失去体力',
      target: atom.target,
      amount: atom.amount,
    };
    return broadcast(view);
  },
  applyView(view: GameView, event) {
    const p = viewPlayer(view, event.target as number);
    if (!p) return;
    p.health = p.health - (event.amount as number);
    // alive 由 death-flow 的 系统处理牌 applyView 更新,这里不提前设(与 扣减体力 对齐)。
  },
  toViewLog(event) {
    return { player: event.target as number, text: `失去 ${event.amount ?? 0} 点体力` };
  },
};

