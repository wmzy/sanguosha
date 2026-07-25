// src/client/utils/skillDisplay.ts — 技能名展示工具
//
// 背景:界版本武将(如界周瑜、界孙策)的技能 id 带"界"前缀(如"界英姿""界制衡"),
// 这些 id 是引擎路由 / skill registry / getSkillDescription 查询的 key,不能改。
// 但武将本身已是界版本,前端展示时前缀冗余、不美观 → 展示文本去掉前导单个"界"。
//
// 规则:只去掉前导单个"界"字符;不带"界"的标版技能名(如"英姿""制衡")原样返回。
// 例:"界英姿"→"英姿"、"界护驾·摸牌"→"护驾·摸牌"、"英姿"→"英姿"。
//
// 重要:此函数仅用于"展示文本"。所有按 id 查找描述/资源的逻辑(getSkillDescription、
// registry、卡牌资源)必须继续使用原 id,不得传入去前缀后的名字。

/**
 * 去掉技能展示名前导单个"界"字符(仅影响展示,不影响 id / 查找 key)。
 *
 * - "界英姿"   → "英姿"
 * - "界护驾·摸牌" → "护驾·摸牌"
 * - "英姿"     → "英姿"(标版不变)
 * - "界"      → ""(纯前缀的极端情形)
 * - ""        → ""
 */
export function displaySkillName(name: string): string {
  // 仅剥离前导单个"界";用 startsWith + slice 表意清晰,避免误伤中段"界"字。
  return name.startsWith('界') ? name.slice(1) : name;
}
