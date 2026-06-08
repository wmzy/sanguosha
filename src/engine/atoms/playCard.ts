// engine/atoms/playCard.ts — 出牌 v2 兼容占位 atom
//
// 现状：[P5-T3] 阶段 D 删 v2 基础设施前，提供 atom 化占位，
// 让 card-handlers handlePlayCard 改用 applyAtoms 派发此事件，
// ATOM_GAME_EVENTS 在 applyAtoms 内部自动触发 v2 派发管道，
// 消除手工 emitEvent 调用。
//
// 本占位原子：apply 不改 state，toEvents 输出 server event '出牌' 供 log/审计。
// 真实业务仍由 handlePlayCard 主流程（移动牌/累计出杀/推入待定）原子承载。
import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';

export function register() {
  registerAtom({
    type: '出牌',
    apply(s: GameState) {
      return s;
    },
  });
}
