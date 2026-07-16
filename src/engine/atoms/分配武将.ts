// src/engine/atoms/分配武将.ts
// 选将完成时分配武将给玩家(主动选将/超时自动分配共用)。
// 走 atom 管线:toViewEvents 携带角色信息,applyView 更新前端 view。
import type { AtomDefinition, ViewEventSplit, ViewEvent, Faction } from '../types';
import { registerAtom } from '../atom';
import { getCharacterMeta } from '../character-meta';

/** 计算分配武将后的体力上限:基础值=武将卡牌 maxHealth。
 *  主公加成:标准身份局(玩家数>4,即 5 人起)主公体力上限 +1。
 *  baseMax 缺失时 fallback 4(与 create() stub 默认值一致)。 */
function resolveMaxHealth(
  baseMax: number | undefined,
  identity: string | undefined,
  playerCount: number,
): number {
  const base = baseMax ?? 4;
  return identity === '主公' && playerCount > 4 ? base + 1 : base;
}

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
    // 从角色配置查 faction(魏蜀吴群)和 maxHealth。character 必为角色池中的合法武将名,
    // meta 一定能查到;查不到时保留 undefined,与历史行为一致(各读 faction 的技能
    // 对 undefined 一律判为不匹配,不会误触发)。
    const meta = getCharacterMeta(atom.character);
    if (meta) p.faction = meta.faction;
    // 设置体力:基础值=武将卡牌 maxHealth,主公在人数>4(标准身份局)时 +1。
    // 抽身份在选将之前,此处 identity 已确定。
    const maxHp = resolveMaxHealth(meta?.maxHealth, p.identity, state.players.length);
    p.maxHealth = maxHp;
    p.health = maxHp;
  },
  toViewEvents(state, atom): ViewEventSplit {
    const meta = getCharacterMeta(atom.character);
    // toViewEvents 在 apply 之前调用,identity 此时已是抽身份后的最终值。
    const identity = state.players[atom.target]?.identity;
    const maxHp = resolveMaxHealth(meta?.maxHealth, identity, state.players.length);
    const view: ViewEvent = {
      type: '分配武将',
      target: atom.target,
      character: atom.character,
      skills: atom.skills,
      // faction 是公开信息(角色势力),所有视角可见,与 character 一并下发
      faction: meta?.faction,
      // 体力值随角色分配一并下发,前端 applyView 据此同步 health/maxHealth
      maxHealth: maxHp,
      health: maxHp,
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
    const maxHp = event.maxHealth as number | undefined;
    if (typeof maxHp === 'number') {
      view.players[pi].maxHealth = maxHp;
      view.players[pi].health = maxHp;
    }
  },
};

registerAtom(分配武将);
