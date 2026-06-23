// src/engine/atoms/分配武将.ts
// 选将完成时分配武将给玩家(主动选将/超时自动分配共用)。
// 走 atom 管线:toViewEvents 携带角色信息,applyView 更新前端 view。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { DEFAULT_SKILLS } from './选将';

export const 分配武将: AtomDefinition<{ target: number; character: string; skills: string[] }> = {
  type: '分配武将',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    if (!atom.character) return 'character required';
    return null;
  },
  apply(state, atom) {
    const p = state.players[atom.target];
    if (!p) return;
    p.character = atom.character;
    p.name = atom.character;
    p.skills = atom.skills;
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '分配武将',
      target: atom.target,
      character: atom.character,
      skills: atom.skills,
    };
    // 所有玩家都能看到角色分配结果(角色名是公开信息)
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const target = event.target as number;
    const character = event.character as string;
    const skills = (event.skills ?? []) as string[];
    const pi = view.players.findIndex(p => p.index === target);
    if (pi < 0) return;
    view.players[pi].character = character;
    view.players[pi].name = character;
    view.players[pi].skills = skills;
  },
};

registerAtom(分配武将);
