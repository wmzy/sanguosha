// src/engine/skills/_equipReplace.ts — 装备替换共享序列。
//
// 「移除技能(旧装备,若有技能模块)→ 卸下 → 移动牌(旧→弃牌堆)→ 装备(新牌)→
//   添加技能(新牌,若有技能模块)」在 直谏(界)/箜声/界窃听/据守(界据守共用)/界结姻/
// 界甘露 与 装备通用 的 use 序列中逐字重复,收敛于此。旧装备无技能模块时不多发
// 移除技能 atom(与 装备通用 对齐)。
//
// 前置约定:newCardId 必须已在 player 手牌中(装备 atom validate 要求;调用方负责
// 先 移动牌/给予/获得 把牌交到 player 手上)。slot 已有旧装备时先替换——会触发
// 「失去装备」类技能(如枭姬),属预期。栏位为空时仅 装备+添加技能。
import type { EquipSlot, GameState } from '../types';
import { applyAtom } from '../core/apply';
import { hasSkillModule } from './registry';

/** 把 newCardId(须已在 player 手牌中)装备到 player 的 slot:
 *  先替换同槽旧装备(移除技能→卸下→弃置),再 装备 并挂载新牌自带技能(若有)。 */
export async function equipReplacingOld(
  state: GameState,
  player: number,
  slot: EquipSlot,
  newCardId: string,
): Promise<void> {
  const currentEquip = state.players[player].equipment[slot];
  if (currentEquip) {
    // 替换前先移除旧装备的自带技能实例(防止旧技能 hook 残留)
    const oldCard = state.cardMap[currentEquip];
    if (oldCard?.name && hasSkillModule(oldCard.name)) {
      await applyAtom(state, { type: '移除技能', player, skillId: oldCard.name });
    }
    await applyAtom(state, { type: '卸下', player, slot });
    await applyAtom(state, {
      type: '移动牌',
      cardId: currentEquip,
      from: { zone: '手牌', player },
      to: { zone: '弃牌堆' },
    });
  }
  await applyAtom(state, { type: '装备', player, cardId: newCardId });
  const newCard = state.cardMap[newCardId];
  if (newCard?.name && hasSkillModule(newCard.name)) {
    await applyAtom(state, { type: '添加技能', player, skillId: newCard.name });
  }
}
