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

import type { Mark } from '../../engine/types';

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

/** 座位卡标记行徽章:聚合后的展示条目(key=组 key,label=徽章文案,title=tooltip 明细) */
export interface DisplayMarkBadge {
  key: string;
  label: string;
  title: string;
}

/** 把引擎原始 mark 集合聚合为玩家可读徽章。
 *  mark id 约定 `技能名/属性:N`(N=state.seq 计数后缀):计数型标记
 *  (界血裔/裔:17、界血裔/裔:18 …)合并为「血裔·裔 ×2」一条;无命名空间前缀
 *  的 id 原样展示。payload 只进 tooltip,不再把 JSON 塞到座位面板上。 */
export function groupDisplayMarks(marks: readonly Mark[]): DisplayMarkBadge[] {
  const groups = new Map<
    string,
    { labelBase: string; titleBase: string; count: number; payloads: string[] }
  >();
  for (const m of marks) {
    // 'chained' 已由卡边框铁链光泽 + ⛓ 徽章代表,这里不重复显示
    if (m.id === 'chained') continue;
    const slash = m.id.indexOf('/');
    const skill = slash > 0 ? m.id.slice(0, slash) : '';
    const attr = (slash > 0 ? m.id.slice(slash + 1) : m.id).split(':')[0] || m.id;
    const key = skill ? `${skill}/${attr}` : attr;
    let g = groups.get(key);
    if (!g) {
      const skillLabel = skill ? displaySkillName(skill) : '';
      g = {
        labelBase: skillLabel ? `${skillLabel}·${attr}` : attr,
        titleBase: key,
        count: 0,
        payloads: [],
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (m.payload !== undefined && m.payload !== null) g.payloads.push(JSON.stringify(m.payload));
  }
  return [...groups.entries()].map(([key, g]) => ({
    key,
    label: g.count > 1 ? `${g.labelBase} ×${g.count}` : g.labelBase,
    title: g.payloads.length > 0 ? `${g.titleBase}（${g.payloads.join('、')}）` : g.titleBase,
  }));
}
