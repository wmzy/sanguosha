// src/engine/atoms/加标记.ts
// 加标记:为玩家添加一个 Mark
import type { AtomDefinition, Mark, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 加标记: AtomDefinition<{
  player: number;
  mark: Mark;
  distanceVars?: { attackMod?: number; defenseMod?: number; attackRange?: number };
}> = {
  type: '加标记',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    state.players[atom.player].marks.push(atom.mark);
  },
  effect: { sound: 'mark', animation: 'pulse', duration: 400 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '加标记',
      player: atom.player,
      mark: atom.mark,
    };
    // 技能(如屯田)携带距离修正 view 同步通道:与 装备/添加技能 的 distanceVars 通道一致。
    // 后端 vars 由技能自行维护(apply 不触碰 vars);此处仅做 view 增量同步。
    if (atom.distanceVars) {
      view.distanceVars = atom.distanceVars;
    }
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const mark = event.mark as Mark | undefined;
    if (mark) view.players[pi].marks.push(mark);
    // 距离修正 view 同步(技能如屯田加田时携带)
    const dv = event.distanceVars as
      | { attackMod?: number; defenseMod?: number; attackRange?: number }
      | undefined;
    if (dv) {
      view.players[pi].distanceVars = {
        ...view.players[pi].distanceVars,
        ...dv,
      };
    }
  },
};

registerAtom(加标记);
