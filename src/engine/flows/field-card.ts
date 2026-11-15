// src/engine/flows/field-card.ts — 场上牌(手牌+装备+判定区)枚举与移动原语。
//
// 巧变/界巧变(跳过出牌阶段移动场上牌)与 解围效果②(翻回正面移动场上牌)共用:
// 先枚举源玩家场上牌供选择,再按所选牌实际所在区域移动到目标玩家场上。
//
// 判定区牌的实体归属约定见 core/judge-zone.ts 头注释:延时锦囊在使用时实体牌
// 就已入弃牌堆,判定区 PendingTrick 只持牌面快照——移动判定区牌必须
// 移除延时锦囊(清快照)+ obtainJudgeZoneCard(按实体牌实际归属转移),
// 不得直接 获得(获得.apply 只 filter 源方手牌/装备、不从弃牌堆移除,
// 会让同一张牌同时存在于弃牌堆与目标手牌,重洗后同牌两实例)。
import type { GameState } from '../types';
import { applyAtom } from '../core/apply';
import { obtainJudgeZoneCard } from '../core/judge-zone';

/** 取玩家"场上"的牌(手牌+装备+判定区)——用于源牌选择 */
export function fieldCardIds(state: GameState, player: number): string[] {
  const p = state.players[player];
  if (!p) return [];
  const hand = [...p.hand];
  const equip = Object.values(p.equipment).filter((id): id is string => !!id);
  const judge = p.pendingTricks.map((t) => t.card.id);
  return [...hand, ...equip, ...judge];
}

/**
 * 把 srcPlayer 场上的 srcCardId 移动到 destPlayer 场上。
 * 自动按 srcCardId 所在区域选择合适的转移方式(统一落到目标手牌):
 *   - 判定区牌:先移除延时锦囊(清快照),再按实体牌实际归属转移(obtainJudgeZoneCard)
 *   - 手牌/装备:统一移到目标手牌(获得 atom 自动处理 hand/equip 的 filter;
 *     不直接换装备槽——装备 atom 有技能加载等副作用,且目标可能已有同槽装备,
 *     规则 FAQ 允许移动到任意合法位置,手牌是合法位置)
 */
export async function moveFieldCard(
  state: GameState,
  srcPlayer: number,
  srcCardId: string,
  destPlayer: number,
): Promise<void> {
  if (srcPlayer === destPlayer) return; // 同一玩家:无意义
  const srcP = state.players[srcPlayer];
  if (!srcP) return;
  const card = state.cardMap[srcCardId];
  if (!card) return;

  // 判定区牌:先从判定区移除快照,再按实体牌实际归属转移(见文件头注释)
  const judgeTrick = srcP.pendingTricks.find((t) => t.card.id === srcCardId);
  if (judgeTrick) {
    await applyAtom(state, {
      type: '移除延时锦囊',
      player: srcPlayer,
      trickName: judgeTrick.name,
    });
    await obtainJudgeZoneCard(state, srcPlayer, srcCardId, destPlayer);
    return;
  }

  // 装备牌:目标对应装备槽空闲 → 通过 移动牌(手牌区)转移到目标手牌(简化:
  //   不直接换装备槽,因 装备 atom 会触发技能加载等副作用,且目标可能已有同槽装备)。
  //   实际规则允许换装备,这里统一进目标手牌(规则 FAQ:任意合法位置,手牌是合法位置)。
  // 手牌/装备 → 目标手牌(获得 atom 自动处理 hand/equip 的 filter)
  await applyAtom(state, {
    type: '获得',
    player: destPlayer,
    cardId: srcCardId,
    from: srcPlayer,
  });
}
