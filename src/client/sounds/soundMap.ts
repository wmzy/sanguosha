// src/client/sounds/soundMap.ts
// 音效标识符 → 资源路径映射。
//
// 音效分两类:
//   1. 通用拟声(底层操作):摸牌/弃牌/获得/判定等统一用 flip 短促拟声。
//   2. 牌名语音(使用/打出时):使用/打出牌时按牌名播报,标识符为 `card/{牌名}`。
//      由 使用时 / 打出牌时 atom 的 toViewEvents 动态设置 effect.sound。
//
// 解析路径:resolveSoundUrl(id) → resourceManager.get(`sound/${id}`)
//   - flip           → sound/flip.mp3
//   - card/杀        → sound/card/杀.mp3
//   - card/无中生有  → sound/card/无中生有.mp3
//   无对应音频文件的标识符 → audioEngine 404 负缓存静默跳过。
//
// ─── 资源放置说明 ───
// 音频文件在 public/packs/base/sound/ 下,由 manifest.json 声明,ResourceManager 解析。
// 文件缺失时静默跳过(负缓存)。格式建议 mp3。

/**
 * 通用音效标识符 → 资源 URL 映射(文档参考,实际解析走 ResourceManager)。
 *
 * | 标识符           | 语义                           | 触发 atom / 派生事件                              |
 * |-----------------|--------------------------------|---------------------------------------------------|
 * | flip            | 通用卡牌操作拟声(短促)        | 摸牌/弃牌/获得/给予/扣牌/判定/展示/拼点 等         |
 * | card_place      | 整理牌堆                       | 整理牌堆                                           |
 * | shuffle         | 重洗                           | 重洗                                               |
 * | heal            | 回复体力                       | 回复体力                                           |
 * | lose_health     | 失去体力(非伤害型)            | 失去体力                                           |
 * | sos_male/female | 濒死求救(按武将性别)          | 陷入濒死(toViewEvents 动态选)                     |
 * | death           | 角色死亡                       | 亮身份牌 / 系统处理牌                              |
 * | equip           | 装备                           | 装备                                               |
 * | unequip         | 卸下装备                       | 卸下                                               |
 * | chain           | 铁索连环 / 加标记 / 去标记     | 设横置 / 加标记 / 去标记                            |
 * | turn_start      | 回合开始                       | 回合开始                                           |
 * | turn_end        | 回合结束                       | 回合结束                                           |
 * | phase_start     | 阶段开始                       | 阶段开始                                           |
 * | phase_end       | 阶段结束                       | 阶段结束                                           |
 *
 * 牌名语音(动态标识符,不在下表中):
 * | card/杀         | 杀                             | 使用时(出杀)                                     |
 * | card/无中生有   | 无中生有                       | 使用时                                             |
 * | card/过河拆桥   | 过河拆桥                       | 使用时                                             |
 * | card/知己知彼   | 知己知彼                       | 使用时                                             |
 * | card/顺手牵羊   | 顺手牵羊                       | 使用时                                             |
 * | card/火攻       | 火攻                           | 使用时                                             |
 * | card/闪电       | 闪电                           | 使用时                                             |
 * | card/乐不思蜀   | 乐不思蜀                       | 使用时                                             |
 * | card/无懈可击   | 无懈可击                       | 使用时                                             |
 * | card/桃         | 桃                             | 使用时                                             |
 * | card/酒         | 酒                             | 使用时                                             |
 * | card/闪         | 闪                             | 使用时                                             |
 * | card/南蛮入侵   | 南蛮入侵                       | 使用时                                             |
 * | card/桃园结义   | 桃园结义                       | 使用时                                             |
 * | card/五谷丰登   | 五谷丰登                       | 使用时                                             |
 * | card/借刀杀人   | 借刀杀人                       | 使用时                                             |
 * | card/铁索连环   | 铁索连环                       | 使用时                                             |
 * | card/兵粮寸断   | 兵粮寸断                       | 使用时                                             |
 * | card/决斗       | 决斗                           | 使用时                                             |
 * | card/万箭齐发   | 万箭齐发                       | 使用时                                             |
 * 标准牌堆中所有基本牌+锦囊牌均有语音(共 20 张),装备牌走「装备」atom 通用 equip 音效。
 */

import { resourceManager } from '../resources';

/** 通用音效标识符 → 资源 URL(文档参考,resolveSoundUrl 实际走 ResourceManager)。 */
export const SOUND_MAP: Readonly<Record<string, string>> = {
  // ─── 通用拟声(底层操作) ───
  flip: '/sounds/flip.mp3',
  card_place: '/sounds/card_place.mp3',
  shuffle: '/sounds/shuffle.mp3',
  // ─── 体力/伤害 ───
  // injure_1/2/3: 受伤惨叫(按伤害点数),见系统音效
  heal: '/sounds/heal.mp3',
  lose_health: '/sounds/lose_health.mp3',
  death: '/sounds/death.mp3',
  // ─── 装备/标记 ───
  equip: '/sounds/equip.mp3',
  unequip: '/sounds/unequip.mp3',
  chain: '/sounds/chain.mp3',
  // ─── 回合/阶段 ───
  turn_start: '/sounds/turn_start.mp3',
  turn_end: '/sounds/turn_end.mp3',
  phase_start: '/sounds/phase_start.mp3',
  phase_end: '/sounds/phase_end.mp3',
  // ─── 牌名语音(使用时按牌名动态播放) ───
  // 标识符 = `card/${牌名}`,资源路径 = /sounds/card/{牌名}.mp3
  // 例: 'card/杀' → /sounds/card/杀.mp3
};

/**
 * 根据 sound 标识符解析资源 URL。
 * 支持通用标识符(如 'flip')和牌名标识符(如 'card/杀')。
 * 未登记的标识符返回 null(调用方应跳过)。
 */
export function resolveSoundUrl(soundId: string): string | null {
  return resourceManager.get(`sound/${soundId}`);
}
