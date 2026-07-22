// src/engine/character-meta.ts
// 武将元数据查询函数。从 src/engine/cards/characters/index.ts 的 allCharacters 构建静态 Map。
// 提供按 name 查询 faction / maxHealth / skills / isLord 的便捷 API,供前端展示层复用。

import { allCharacters } from './cards/characters';
import type { Faction, Gender } from './types';

/** 常备主公名单:拥有主公技的武将。
 *  唯一来源:isLord 判定、选将拆分等都基于此常量,不在多处硬编码。 */
export const LORD_CANDIDATES: readonly string[] = [
  '刘备',
  '曹操',
  '孙权',
  '孙策',
  '张角',
  '董卓',
  '刘禅',
] as const;

/** 武将版本前缀。去掉前缀后的名字即为"基础身份"(baseId),
 *  同一 baseId 的多个版本(标/界/SP)在选将时归为一组候选。
 *  例: '界刘备'→'刘备', 'SP赵云'→'赵云', '刘备'→'刘备'。 */
const VARIANT_PREFIXES = ['界', 'SP'] as const;

/** 获取武将的基础身份(baseId):去掉版本前缀后的名字。
 *  同一武将的不同版本共享 baseId,用于选将分组。 */
export function getCharacterBaseId(name: string): string {
  for (const prefix of VARIANT_PREFIXES) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

export interface CharacterMeta {
  name: string;
  faction: Faction;
  maxHealth: number;
  /** 武将性别(男/女),影响结姻/雌雄双股剑等性别相关技能 */
  gender: Gender;
  /** 技能 id 列表 */
  skills: string[];
  /** 是否常备主公(拥有主公技) */
  isLord: boolean;
}

/** 武将源对象的内部表示(items of allCharacters)。
 *  src/engine/cards/characters/*.ts 用对象字面量导出,TS 推断为 { faction: string }。
 *  这里用结构断言把 faction 收窄到 Faction 字面量类型。
 *  isLord 在数据层可选,由 character-meta 内部用 LORD_CANDIDATES 推导,无需改武将文件。 */
interface CharacterSource {
  name: string;
  faction: Faction;
  maxHealth: number;
  gender: Gender;
  skills: Array<{ name: string }>;
  isLord?: boolean;
}

const META: ReadonlyMap<string, CharacterMeta> = new Map(
  allCharacters.map((c) => {
    const src = c as unknown as CharacterSource;
    return [
      src.name,
      {
        name: src.name,
        faction: src.faction,
        maxHealth: src.maxHealth,
        gender: src.gender,
        skills: src.skills.map((s) => s.name),
        isLord: src.isLord === true || LORD_CANDIDATES.includes(getCharacterBaseId(src.name)),
      } satisfies CharacterMeta,
    ];
  }),
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

/** 查询武将性别。未知武将默认 '男'(三国杀武将绝大多数为男性)。 */
export function getGender(name: string): Gender {
  return META.get(name)?.gender ?? '男';
}

/** 查询武将是否是常备主公(拥有主公技)。 */
export function isLord(name: string): boolean {
  return META.get(name)?.isLord ?? false;
}
