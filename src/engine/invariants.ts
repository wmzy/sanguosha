// src/engine/invariants.ts
// 牌唯一归属不变量断言:预防"同一张牌因 atom 逻辑错误同时出现在多个区"的 bug。
//
// 卡牌分布区(均以 cardId 引用,实体卡注册在 state.cardMap):
//   - state.zones.{deck, discardPile, processing}
//   - 各玩家 players[].hand
//   - 各玩家 players[].equipment(武器/防具/进攻马/防御马/宝物 五槽,每槽至多一张)
//   - 各结算帧 state.settlementStack[].cards
//
// 本模块只护栏「重复」:同一 cardId 出现在 >1 个位置即抛错。
// cardMap 中存在但不在任何区(影子卡/转化牌/延时锦囊 pendingTricks 等合法边界),
// 或反之(区中引用了 cardMap 查无的 id),本次只识别、不抛错——先护栏重复。
//
// 默认关闭:仅当 state.assertInvariants === true 时,applyAtom 才在正常完成路径调用。
import type { EquipSlot, GameState } from './types';

/** 装备五槽——遍历 equipment 时按固定顺序读取各槽 */
const EQUIP_SLOTS: readonly EquipSlot[] = ['武器', '防具', '进攻马', '防御马', '宝物'];

/**
 * 检查「牌唯一归属」不变量:遍历所有牌区,统计每个 cardId 的出现位置。
 * 若同一 cardId 出现超过 1 次,抛 Error(列出 cardId 与所有出现位置)。
 *
 * 复杂度 O(n),n 为所有牌区的 cardId 引用总数(一局约百张,可接受)。
 *
 * cardMap 与各区的「孤儿/悬空」关系(影子卡、转化牌、延时锦囊 pendingTricks 等)
 * 属合法边界,本次只识别、不抛错。
 *
 * @throws Error 当某 cardId 在多个牌区重复出现时。
 */
export function assertCardInvariants(state: GameState): void {
  // cardId → 出现位置描述列表;位置字符串人类可读,便于排错定位
  const locations = new Map<string, string[]>();
  const record = (cardId: string, loc: string): void => {
    let arr = locations.get(cardId);
    if (arr === undefined) {
      arr = [];
      locations.set(cardId, arr);
    }
    arr.push(loc);
  };

  // 1) 全局牌区:牌堆 / 弃牌堆 / 处理区
  for (const id of state.zones.deck) record(id, '牌堆');
  for (const id of state.zones.discardPile) record(id, '弃牌堆');
  for (const id of state.zones.processing) record(id, '处理区');

  // 2) 各玩家手牌与装备各槽
  for (const p of state.players) {
    const tag = `玩家${p.index}`;
    for (const id of p.hand) record(id, `${tag}.手牌`);
    for (const slot of EQUIP_SLOTS) {
      const id = p.equipment[slot];
      if (id !== undefined) record(id, `${tag}.装备(${slot})`);
    }
  }

  // 3) 所有结算帧的牌区(嵌套结算时各帧独立,全部纳入统计)
  for (let i = 0; i < state.settlementStack.length; i++) {
    const frame = state.settlementStack[i];
    const loc = `结算帧[${i}](${frame.skillId || '?'})`;
    for (const id of frame.cards) record(id, loc);
  }

  // 重复检测:同一 cardId 出现在 >1 处 → 抛错,列出 cardId 与全部位置
  const dups: string[] = [];
  for (const [cardId, locs] of locations) {
    if (locs.length > 1) {
      const name = state.cardMap[cardId]?.name ?? '?';
      dups.push(`  ${cardId}(${name}) ×${locs.length}: ${locs.join(' / ')}`);
    }
  }
  if (dups.length > 0) {
    throw new Error(`[牌唯一归属不变量] 检测到重复卡牌:\n${dups.join('\n')}`);
  }

  // 孤儿/悬空仅识别(允许影子卡/转化牌/延时锦囊 pendingTricks 等合法边界),不抛错。
  // 如需排查悬空引用(区中存在但 cardMap 查无,通常为 bug),可在 dev 模式临时启用下方诊断:
  // const dangling = [...locations.keys()].filter((id) => !(id in state.cardMap));
  // if (dangling.length > 0) console.warn('[牌不变量] 悬空引用(区中存在但 cardMap 查无):', dangling);
}
