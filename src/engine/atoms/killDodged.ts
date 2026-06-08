// engine/atoms/killDodged.ts — 杀被闪避 v2 兼容占位 atom
//
// 现状：[P5-T3] 阶段 D 删 v2 基础设施前，提供 atom 化占位，
// 让 kill 闪避路径（attacker 杀被 defender 闪躲）改用 applyAtoms 派发此事件，
// ATOM_GAME_EVENTS 在 applyAtoms 内部自动触发 v2 派发管道。
//
// 本占位原子：apply 不改 state，toEvents 输出 server event '杀被闪避' 供 log/审计。
import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';

export function register() {
  registerAtom({
    type: '杀被闪避',
    apply(s: GameState) {
      return s;
    },
  });
}
