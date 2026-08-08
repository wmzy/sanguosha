// src/client/cardVfx.ts — 出牌动效(VFX)的前端映射表。
//
// VFX(视觉特效 ID)属于前端展示层,引擎 atom 不应硬编码。
// 此表从 src/engine/atoms/使用时.ts 迁出,集中在前端管理。
// 缺失映射的牌静默跳过(无 APNG 特效)。

/** 牌名 → APNG 动效 ID 映射(杀的基础动效;火/雷属性杀见下方分支) */
const CARD_VFX: Record<string, string> = {
  杀: 'card/slash_red',
  闪: 'card/jink',
  桃: 'card/peach',
  酒: 'card/analeptic',
  决斗: 'card/duel',
  铁索连环: 'card/chain',
  无懈可击: 'card/skill_nullify',
};

/** 根据牌名 + 伤害属性计算出牌动效 ID。无匹配返回 null(静默跳过)。
 *  杀区分火/雷属性;其余牌按牌名查表。 */
export function getCardVfx(cardName: string, damageType?: string): string | null {
  if (cardName === '杀') {
    if (damageType === '火焰') return 'card/fire_slash';
    if (damageType === '雷电') return 'card/thunder_slash';
  }
  return CARD_VFX[cardName] ?? null;
}
