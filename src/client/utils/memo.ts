// src/client/utils/memo.ts
// React.memo 自定义比较器工具集。
//
// 背景:WebSocket 驱动的三国杀前端,每次 view 更新会创建全新的 view 对象(JSON 反序列化),
// 导致所有接收 view 的子组件引用变化、触发重渲染。本模块提供浅比较工具,
// 供各组件的 React.memo comparator 使用,跳过"值未变但引用变了"的无意义重渲染。
//
// 设计原则:
// - 比较器必须比组件渲染本身更廉价,否则适得其反
// - 只比较影响渲染输出的字段(primitive + 可见数据),忽略不参与渲染的 prop
// - cardMap 查找是确定性的(cardId → 不可变 Card),所以只要 cardId 集合不变,
//   渲染结果不变——比较器中无需比较 cardMap 本身

import type { GameView } from '../../engine/types';

type Player = GameView['players'][number];

/** 浅比较两个只读数组(元素为 primitive,用 === 比较) */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 浅比较两个对象(比较 own enumerable keys + 值,值为 primitive) */
export function shallowObjectEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k as keyof T] !== b[k as keyof T]) return false;
  }
  return true;
}

/** 浅比较两个 Set */
export function shallowSetEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

/** 比较 marks 数组(按 id + payload JSON 比较) */
function marksEqual(a: Player['marks'], b: Player['marks']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (JSON.stringify(a[i].payload) !== JSON.stringify(b[i].payload)) return false;
  }
  return true;
}

/**
 * 比较两个 Player 的**可见字段**(影响座位卡/角色卡渲染的字段)。
 * cardMap 查找不在此比较——cardId 不变则卡片显示不变。
 */
export function playerVisibleEqual(a: Player, b: Player): boolean {
  return (
    a.name === b.name &&
    a.character === b.character &&
    a.health === b.health &&
    a.maxHealth === b.maxHealth &&
    a.alive === b.alive &&
    a.identity === b.identity &&
    a.identityHidden === b.identityHidden &&
    a.handCount === b.handCount &&
    shallowArrayEqual(a.skills, b.skills) &&
    shallowObjectEqual(a.equipment, b.equipment) &&
    shallowArrayEqual(a.pendingTricks ?? [], b.pendingTricks ?? []) &&
    marksEqual(a.marks, b.marks)
  );
}
