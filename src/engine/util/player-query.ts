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
//   - equipmentCardIds/equipSlotOf:恃才/界结姻 的 findEquipSlot 两处逐字同构
//     (鬼才 findCardLocation 多一个手牌分支,不纳入);
//   - hasObtainableCards:顺手牵羊/过河拆桥 的
//     「手牌/装备区/判定区任一有牌」canUse 校验两处逐字相同;
//   - alivePlayersClockwiseFrom:cards/validate.computeAutoTargets / 五谷丰登.alivePlayersFrom /
//     界乱击.defaultTargets 三处「存活角色按座位递减自 from 起的有序列表」
//     (三者仅起点含不含自己不同,用 opts 表达);
//   - findNextAlive 的可选谓词:闪电.findNextRecipient 的判定区过滤
//     (全亡/无匹配时返回 fromIndex 的既有语义不变)。
// 依赖仅限 types + data/character-meta(getGender) + util/equip-slot(EQUIP_SLOTS)。
// 命名:函数名英文;业务字面量('男'/'杀')保持中文。
import type { Card, EquipSlot, GameState, PlayerState } from '../types';
import { getHealthValue } from '../types';
import { getGender } from '../data/character-meta';
import { EQUIP_SLOTS } from './equip-slot';

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

/** 逆时针(座次递减)从 fromIndex 的下一位找第一个存活玩家;全死亡时返回 fromIndex。
 *  predicate:候选玩家的附加过滤(如 闪电 传 (p) => 判定区无同名延时锦囊);
 *  无 predicate 时与原三处逐字实现完全等价(向后兼容)。 */
export function findNextAlive<P extends { alive: boolean }>(
  state: { players: P[] },
  fromIndex: number,
  predicate?: (player: P, idx: number) => boolean,
): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex - i + n) % n;
    const p = state.players[idx];
    if (p?.alive && (!predicate || predicate(p, idx))) return idx;
  }
  return fromIndex;
}

/** 存活角色按座位递减方向(引擎「逆时针」,与 下一玩家 atom / findNextAlive 一致)
 *  自 fromIndex 起的有序座次列表。收敛三处调用点,起点差异用 opts 表达:
 *    - includeSelf(默认 true):fromIndex 自身存活时是否列于首位
 *      (false = computeAutoTargets 的 allOthers / 五谷丰登含自己 / 界乱击不含自己);
 *    - startOffset(默认 0):起点再沿逆时针跳过若干名存活角色。
 *  fromIndex 不在存活列表(已死/不存在)时按座位升序返回全部存活角色
 *  (computeAutoTargets/五谷丰登 的既有兜底;界乱击 原为空数组,其 from 为使用者,实际不可达)。 */
export function alivePlayersClockwiseFrom(
  state: { players: { alive: boolean; index: number }[] },
  fromIndex: number,
  opts?: { includeSelf?: boolean; startOffset?: number },
): number[] {
  const alive = state.players.filter((p) => p.alive);
  const n = alive.length;
  if (n === 0) return [];
  const fromPos = alive.findIndex((p) => p.index === fromIndex);
  if (fromPos < 0) return alive.map((p) => p.index);
  const skip = (opts?.includeSelf === false ? 1 : 0) + (opts?.startOffset ?? 0);
  const result: number[] = [];
  for (let i = skip; i < n; i++) {
    result.push(alive[(fromPos - i + n) % n].index);
  }
  return result;
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

/** 玩家装备区全部 cardId(按 EQUIP_SLOTS 槽位序);玩家不存在返回空数组。 */
export function equipmentCardIds(
  player: Pick<PlayerState, 'equipment'> | undefined | null,
): string[] {
  if (!player) return [];
  return Object.values(player.equipment).filter((id): id is string => !!id);
}

/** 武器栏是否装备了指定卡名的武器(寒冰剑/古锭刀/麒麟弓/方天画戟/朱雀羽扇/
 *  雌雄双股剑/青釭剑/丈八蛇矛/借刀杀人 的触发守卫共用:玩家存在 + 有武器 +
 *  cardMap 中该武器卡名 === name)。技能实例随装备挂载/卸载,守卫仍需比对卡名
 *  以排除同技能名的其他来源(如转化/影子卡)。 */
export function equippedWeaponIs(state: GameState, ownerId: number, name: string): boolean {
  const weaponId = state.players[ownerId]?.equipment['武器'];
  if (!weaponId) return false;
  return state.cardMap[weaponId]?.name === name;
}

/** cardId 所在的装备槽;不在该玩家装备区(或玩家不存在)返回 null。
 *  恃才/界结姻 的 findEquipSlot 共用;鬼才 的 findCardLocation 多手牌分支,不纳入。 */
export function equipSlotOf(
  player: Pick<PlayerState, 'equipment'> | undefined | null,
  cardId: string,
): EquipSlot | null {
  if (!player) return null;
  for (const slot of EQUIP_SLOTS) {
    if (player.equipment[slot] === cardId) return slot;
  }
  return null;
}

/** 玩家是否有可被获取/弃置的牌(手牌、装备区或判定区任一有牌);
 *  顺手牵羊/过河拆桥 的「目标无可获取/弃置的牌」canUse 校验共用。 */
export function hasObtainableCards(
  player: Pick<PlayerState, 'hand' | 'equipment' | 'pendingTricks'> | undefined | null,
): boolean {
  if (!player) return false;
  return (
    player.hand.length > 0 ||
    equipmentCardIds(player).length > 0 ||
    player.pendingTricks.length > 0
  );
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
