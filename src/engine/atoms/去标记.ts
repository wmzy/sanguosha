// src/engine/atoms/去标记.ts
// 去标记:移除玩家第一个匹配 markId 的 Mark
// 可选 distanceVars:与「加标记」对称的 view 同步通道。
//   动态距离修正按能(如 界义从:体力变化触发防御修正 ±)在去标记时也需要同步 view,
//   故此处复用 distanceVars 通道。apply 不触碰 vars(state 侧由技能维护),仅 view 增量同步。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 去标记: AtomDefinition<{
  player: number;
  markId: string;
  distanceVars?: { attackMod?: number; defenseMod?: number; attackRange?: number };
}> = {
  type: '去标记',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const idx = player.marks.findIndex((m) => m.id === atom.markId);
    if (idx < 0) return;
    player.marks.splice(idx, 1);
  },
  effect: { sound: 'mark', animation: 'pulse', duration: 300 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '去标记',
      player: atom.player,
      markId: atom.markId,
    };
    // 与「加标记」对称:技能携带 distanceVars 时同步到 view。
    // value 为 undefined 的 key 用于清除 view 侧对应字段(与 'clearMountDistanceVars' 语义一致)。
    if (atom.distanceVars) {
      view.distanceVars = atom.distanceVars;
    }
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const markId = event.markId as string | undefined;
    if (markId) {
      view.players[pi].marks = view.players[pi].marks.filter((m) => m.id !== markId);
    }
    // 距离修正 view 同步(技能如 界义从 切换低血防御时携带)
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

registerAtom(去标记);
