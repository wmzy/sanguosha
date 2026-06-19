// src/engine/character-meta.ts
// 武将元数据查询函数。从 src/engine/cards/characters/index.ts 的 allCharacters 构建静态 Map。
// 提供按 name 查询 faction / maxHealth / skills 的便捷 API,供前端展示层复用。

import { allCharacters } from './cards/characters';
import type { Faction } from './types';

export interface CharacterMeta {
  name: string;
  faction: Faction;
  maxHealth: number;
  /** 技能 id 列表 */
  skills: string[];
}

/** 武将源对象的内部表示(items of allCharacters)。
 *  src/engine/cards/characters/*.ts 用对象字面量导出,TS 推断为 { faction: string }。
 *  这里用结构断言把 faction 收窄到 Faction 字面量类型。 */
interface CharacterSource {
  name: string;
  faction: Faction;
  maxHealth: number;
  skills: Array<{ name: string }>;
}

const META: ReadonlyMap<string, CharacterMeta> = new Map(
  allCharacters.map((c) => {
    const src = c as unknown as CharacterSource;
    return [src.name, {
      name: src.name,
      faction: src.faction,
      maxHealth: src.maxHealth,
      skills: src.skills.map(s => s.name),
    } satisfies CharacterMeta];
  })
);

export function getCharacterMeta(name: string): CharacterMeta | undefined {
  return META.get(name);
}

export function getFaction(name: string): Faction {
  return META.get(name)?.faction ?? '群';
}

export function getMaxHealth(name: string): number {
  return META.get(name)?.maxHealth ?? 4;
}