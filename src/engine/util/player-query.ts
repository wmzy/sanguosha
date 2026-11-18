// src/engine/util/player-query.ts — 玩家/全场状态查询的共享小助手。
//
// 收敛 skills/ 下语义一致的玩家判定样板(来源与差异说明):
//   - isMaleAlive:界燕语/界结姻/界荐言/离间 四处逐字相同;
//   - lostHealth:界伤逝/界甘露/界秘计 三处逐字相同
//     (已损失体力值 = max(0, maxHealth - 体力值),体力值封底 0,濒死负数不放大 X);
//   - countFactions:界伏枥/界宗室/界自守 三处逐字相同(全场存活玩家的不同势力数);
//   - findNextAlive:回合管理/界直言/界纵玄 三处逐字相同
//     (逆时针 = 座次递减,与 下一玩家 atom 推进方向一致;全死亡返回 fromIndex);
//   - totalCardCount:界破军/界镇军(player 对象形状)与 界缔盟((state, idx) 形状,
//     缺玩家 → 0)——统一为接 player 对象,缔盟的缺玩家语义并入本函数(undefined → 0);
//   - hasDiscardableCards:奇制/界弓骑/界旋风 三处逐字相同;掣政 的 hasAnyCard
//     (state, idx) 语义相同(手牌或装备有牌),调用方自行取 player 后复用;
//   - ownsCard:制衡/界苦肉/界明策/国色/界国色/界天香/界看破 的
//     「牌在手牌或装备区」内联表达式(includes/some 写法差异,语义一致);
//   - ownedCardIds:界国色/界破军/界镇军/界天香 的
//     「手牌 + 装备区全部 cardId」手写拼接(手牌在前,装备槽位值序);
//   - isSlashCard/isSlashCardById:同一谓词(含转化/影子杀——name 即 '杀')的两种
//     入参形状——card 对象(界明策)与 cardId(拒战/界破军),不做合并以免调用方反复解包。
// 依赖仅限 types + data/character-meta(getGender)。
// 命名:函数名英文;业务字面量('男'/'杀')保持中文。
import type { Card, GameState, PlayerState } from '../types';
import { getHealthValue } from '../types';
import { getGender } from '../data/character-meta';

/** 座次是否为存活男性角色(离间/界结姻/界荐言/界燕语 的目标校验共用)。 */
export function isMaleAlive(state: GameState, idx: number): boolean {
  const p = state.players[idx];
  if (!p?.alive) return false;
  return getGender(p.character) === '男';
}

/** 已损失体力值 X = max(0, maxHealth - 体力值);座次不存在返回 0。 */
export function lostHealth(state: GameState, idx: number): number {
  const p = state.players[idx];
  if (!p) return 0;
  return Math.max(0, p.maxHealth - getHealthValue(p));
}

/** 全场存活玩家的不同势力数(势力未设置的角色不计入)。 */
export function countFactions(state: GameState): number {
  const factions = new Set<string>();
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.faction) factions.add(p.faction);
  }
  return factions.size;
}

/** 逆时针(座次递减)从 fromIndex 的下一位找第一个存活玩家;全死亡时返回 fromIndex。 */
export function findNextAlive(
  state: { players: { alive: boolean }[] },
  fromIndex: number,
): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex - i + n) % n;
    if (state.players[idx]?.alive) return idx;
  }
  return fromIndex;
}

/** 玩家「场上」总牌数(手牌 + 装备区);玩家不存在返回 0。 */
export function totalCardCount(
  player: Pick<PlayerState, 'hand' | 'equipment'> | undefined | null,
): number {
  if (!player) return 0;
  const equipCount = Object.values(player.equipment).filter(
    (id): id is string => typeof id === 'string',
  ).length;
  return player.hand.length + equipCount;
}

/** 玩家区域(手牌 + 装备)是否有牌可供弃置。 */
export function hasDiscardableCards(
  player: Pick<PlayerState, 'hand' | 'equipment'> | undefined | null,
): boolean {
  if (!player) return false;
  if (player.hand.length > 0) return true;
  return Object.values(player.equipment).some((id) => typeof id === 'string');
}

/** 牌是否归玩家所有(在其手牌或装备区)。 */
export function ownsCard(
  player: Pick<PlayerState, 'hand' | 'equipment'> | undefined | null,
  cardId: string,
): boolean {
  if (!player) return false;
  if (player.hand.includes(cardId)) return true;
  return Object.values(player.equipment).some((id) => id === cardId);
}

/** 玩家拥有的所有 cardId(手牌在前 + 装备区各槽位);玩家不存在返回空数组。 */
export function ownedCardIds(
  player: Pick<PlayerState, 'hand' | 'equipment'> | undefined | null,
): string[] {
  if (!player) return [];
  return [
    ...player.hand,
    ...Object.values(player.equipment).filter((id): id is string => typeof id === 'string'),
  ];
}

/** 卡牌是否为【杀】(含转化/影子杀——name 即 '杀');入参为 card 对象。 */
export function isSlashCard(card: Card | undefined): boolean {
  return !!card && card.name === '杀';
}

/** cardId 对应的卡牌是否为【杀】(含转化/虚拟杀);cardId 为空或不在 cardMap 返回 false。 */
export function isSlashCardById(state: GameState, cardId: string | undefined): boolean {
  if (!cardId) return false;
  return isSlashCard(state.cardMap[cardId]);
}
