// src/engine/data/character-strength.ts
// 武将强度偏好数据:技能强度高的常见主力白名单。
// 消费方:ai-mcp/heuristics(选将加分 / 无懈可击保护价值)。可按需扩展。

/** 强力武将白名单(技能强度高的常见主力)。 */
export const STRONG_CHARACTERS: ReadonlySet<string> = new Set([
  '诸葛亮',
  '司马懿',
  '曹操',
  '刘备',
  '孙权',
  '貂蝉',
  '甄姬',
  '郭嘉',
  '陆逊',
  '黄月英',
  '孙尚香',
  '张角',
  '华佗',
  '吕布',
  '夏侯渊',
  '张飞',
  '许褚',
]);
