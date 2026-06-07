// engine/atoms/turnEnd.ts — 回合结束 v2 兼容占位 atom
//
// 现状：[P5-T3] 阶段 D 删 v2 基础设施前，提供 atom 化占位，
// 让 turn-handlers handleEndTurn 改用 applyAtoms 派发此事件，
// ATOM_GAME_EVENTS 在 applyAtoms 内部自动触发 v2 派发管道。
//
// 本占位原子：apply 不改 state，toEvents 输出 server event '回合结束' 供 log/审计。
// 真实业务（弃牌阶段推入待定等）由 handleEndTurn 主流程 atom 序列承载。
import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

export function register() {
  registerAtom({
    type: '回合结束',
    apply(s: GameState) {
      return s;
    },
    toEvents(_s, atom): AtomEventResult {
      const a = atom as Atom & { type: '回合结束' };
      const player = (a as { player?: unknown }).player as string;
      return [
        makeServerEvent('回合结束', { player }),
        new Map(),
        null,
      ];
    },
  });
}
