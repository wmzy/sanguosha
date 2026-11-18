// core/judge-zone.ts — 判定区延时锦囊的「实体牌归属」原语。
//
// 引擎模型:延时锦囊在使用时就把实体牌移入弃牌堆(use-card.ts 的 delayed 分支:
// 添加延时锦囊 → 处理区→弃牌堆),判定区 PendingTrick 只持有牌面快照
// { name, source, card }。实体牌的唯一归属是「弃牌堆」(或重洗后被他人摸走后
// 的牌堆/手牌)——判定区不持有实体牌。
//
// 因此任何「清空判定区」的路径(拆/顺/死亡清理/涅槃/行殇)都不得再把这枚实体牌
// 推入某个牌区,否则同一张牌会在弃牌堆出现两次(重洗后同一张牌有两个实例),
// 或同时出现在弃牌堆与某玩家手牌(牌唯一归属不变量被破坏)。
//
// 本模块把「实体牌现在在哪」+「按实际归属处置」收敛为原语,供
// flows/pick-card-panel(顺手牵羊/过河拆桥)、atoms/death-timing(系统处理牌)、
// skills/涅槃|界涅槃|行殇 共用,避免各调用点各自猜测牌的位置。
import type { GameState } from '../types';
import { applyAtom } from './apply';
import { EQUIP_SLOTS } from '../util/equip-slot';

/** 实体牌可能所在的区(不含判定区——判定区只持快照)。 */
export type CardZoneKind = '牌堆' | '弃牌堆' | '处理区' | '手牌' | '装备';

export interface CardLocation {
  zone: CardZoneKind;
  /** 手牌/装备所属玩家座次(其余区无) */
  player?: number;
}

/** 查询实体牌当前所在区。牌不在任何区(仅存于 cardMap 的历史快照/已销毁的虚拟牌)返回 null。 */
export function locateCard(state: GameState, cardId: string): CardLocation | null {
  if (state.zones.deck.includes(cardId)) return { zone: '牌堆' };
  if (state.zones.discardPile.includes(cardId)) return { zone: '弃牌堆' };
  if (state.zones.processing.includes(cardId)) return { zone: '处理区' };
  for (const frame of state.settlementStack) {
    if (frame.cards.includes(cardId)) return { zone: '处理区' };
  }
  for (const p of state.players) {
    if (p.hand.includes(cardId)) return { zone: '手牌', player: p.index };
    for (const slot of EQUIP_SLOTS) {
      if (p.equipment[slot] === cardId) return { zone: '装备', player: p.index };
    }
  }
  return null;
}

/** 弃置判定区延时锦囊的实体牌(拆牌/弃牌类:过河拆桥、涅槃弃判定区、死亡清理)。
 *
 *  实体牌已在某区(正常对局中即弃牌堆)时不再动作——判定区只是快照,重复入堆会让
 *  同一张牌在弃牌堆出现两次。仅当牌不在任何区(历史快照/未实体化的牌)时补入弃牌堆,
 *  与旧行为一致(测试夹具直接构造 pendingTricks 时仍会落堆)。
 *
 *  调用方负责先 移除延时锦囊(清 pendingTricks 快照)。 */
export async function discardJudgeZoneCard(
  state: GameState,
  player: number,
  cardId: string,
): Promise<void> {
  if (locateCard(state, cardId) !== null) return;
  await applyAtom(state, { type: '弃置', player, cardIds: [cardId] });
}

/** 获得判定区延时锦囊的实体牌(顺手牵羊/反馈/行殇)。
 *
 *  实体牌在弃牌堆 → 从弃牌堆移入获得方手牌(牌随技能转移,不复制)。
 *  牌不在任何区 → 直接进获得方手牌(历史快照/未实体化的牌)。
 *  牌在牌堆/他人手牌/处理区 → 快照已过期(实体牌被重洗后已被他人获得),不转移。
 *
 *  调用方负责先 移除延时锦囊(清 pendingTricks 快照)。 */
export async function obtainJudgeZoneCard(
  state: GameState,
  player: number,
  cardId: string,
  to: number,
): Promise<void> {
  const loc = locateCard(state, cardId);
  if (loc === null) {
    await applyAtom(state, { type: '获得', player: to, cardId, from: player });
    return;
  }
  if (loc.zone === '弃牌堆') {
    await applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '弃牌堆' },
      to: { zone: '手牌', player: to },
    });
  }
}
