// src/engine/atoms/分配武将.ts
// 选将完成时分配武将给玩家(主动选将/超时自动分配共用)。
// 走 atom 管线:toViewEvents 携带角色信息,applyView 更新前端 view。
import type { AtomDefinition, ViewEventSplit, ViewEvent, Faction } from '../types';
import { registerAtom } from '../atom';
import { getCharacterMeta } from '../character-meta';

export const 分配武将: AtomDefinition<{ target: number; character: string; skills: string[] }> = {
  type: '分配武将',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    if (!atom.character) return 'character required';
    return null;
  },
  apply(state, atom) {
    const p = state.players[atom.target];
    if (!p) throw new Error(`分配武将: target ${atom.target} not found (validate 已通过)`);
    p.character = atom.character;
    p.name = atom.character;
    p.skills = atom.skills;
    // 从角色配置查 faction(魏蜀吴群)。character 必为角色池中的合法武将名,
    // meta 一定能查到;查不到时保留 undefined,与历史行为一致(各读 faction 的技能
    // 对 undefined 一律判为不匹配,不会误触发)。
    const meta = getCharacterMeta(atom.character);
    if (meta) p.faction = meta.faction;
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const meta = getCharacterMeta(atom.character);
    const view: ViewEvent = {
      type: '分配武将',
      target: atom.target,
      character: atom.character,
      skills: atom.skills,
      // faction 是公开信息(角色势力),所有视角可见,与 character 一并下发
      faction: meta?.faction,
    };
    // 所有玩家都能看到角色分配结果(角色名是公开信息)
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const target = event.target as number;
    const character = event.character as string;
    const skills = (event.skills ?? []) as string[];
    const pi = view.players.findIndex((p) => p.index === target);
    if (pi < 0) return;
    view.players[pi].character = character;
    view.players[pi].name = character;
    view.players[pi].skills = skills;
    const faction = event.faction as Faction | undefined;
    if (faction) view.players[pi].faction = faction;
  },
};

registerAtom(分配武将);
