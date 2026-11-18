// src/engine/util/equip-slot.ts — 装备牌栏位推断。
// 自两份逐字相同的 switch 收敛为单一事实来源:
//   - util/skillRuntime 的 slotOf(据守/界直言/界结姻/直谏/箜声/谦节/雄乱 7 个技能使用);
//   - atoms/装备.ts 的本地 inferSlot(validate/apply/toViewEvents 三处调用)。
// 依赖仅限 types。
import type { EquipSlot } from '../types';

/** 全部装备栏位(按 武器→宝物 顺序)。judge-zone 与装备区遍历类技能共用,勿再内联字面量。 */
export const EQUIP_SLOTS: readonly EquipSlot[] = ['武器', '防具', '进攻马', '防御马', '宝物'];

/** 装备牌 subtype → 装备栏位;非装备牌(或未知 subtype)返回 null。 */
export function slotOf(card: { subtype?: string } | undefined): EquipSlot | null {
  switch (card?.subtype) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}
