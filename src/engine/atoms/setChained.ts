// engine/atoms/setChained.ts — `设横置` atom 改写为 Mark 体系入口
//
// 旧实现：直接写 PlayerState.chained: boolean。
// 新实现（2026-06-06 P5-T1）：chained=true → addMark(CHAINED_MARK)；
//                            chained=false → removeMark('chained')。
// state.marks[player] 即为真源。reducer 在收到 `设横置` 事件时同样按 chained 真假
// 加/去 Mark（与 atom apply 路径完全一致，避免回放漂移）。
//
// Atom 形参保留 `{type, target, chained: boolean}` 不变——外部调用方无破坏。

import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { addMarkToPlayer, removeMarkFromPlayer, CHAINED_MARK } from '../mark';

export function register() {
  registerAtom({
    type: '设横置',
    apply(state: GameState, atom: Atom & { type: '设横置' }): GameState {
      const target = atom.target as string;
      const chained = atom.chained as boolean;
      if (chained) {
        return addMarkToPlayer(state, target, CHAINED_MARK);
      }
      return removeMarkFromPlayer(state, target, 'chained');
    },
    toEvents(_state: GameState, atom: Atom & { type: '设横置' }): AtomEventResult {
      const target = atom.target as string;
      const chained = atom.chained as boolean;
      // payload 保留 target + chained：reducer 与旧重放 log 都用这对参数还原状态。
      // chained 翻译为加/去 Mark 是 reducer 的事（见 view/reducer.ts '设横置' case）。
      const payload: Json = { target, chained };
      const server = makeServerEvent('设横置', payload);
      return [server, new Map(), makePlayerEvent('设横置', payload)];
    },
  });
}
