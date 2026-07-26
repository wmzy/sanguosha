// src/client/sounds/soundMap.ts
// 音效标识符 → 资源路径映射表。
//
// 引擎各 atom 通过 `AtomEffect.sound` 声明音效标识符(字符串),前端在此查表得到
// 实际音频资源 URL。资源约定放在 `public/sounds/{soundId}.mp3`,由 Vite 静态服务。
//
// 取 effect 的统一范式(与 EventBanner 一致):
//   const atomType = event.atomType ?? event.type;
//   const def = getAtomDef(atomType);             // 可能抛,需 try/catch
//   const effect = (event.effect as EventEffect) ?? def.effect;
//   const soundId = effect?.sound;
//
// 注意:派生事件(移动牌派生的"打出/弃牌/摸牌")的 type ≠ atom 名,必须用
// event.atomType ?? event.type 查 def。部分派生事件在 toViewEvents 里直接把 effect
// 挂到 event.effect 上(优先于静态查表)。
//
// ─── 资源放置说明 ───
// 真实音频文件由用户后续放入 public/sounds/。文件缺失时 audioEngine 会静默跳过
// (负缓存:首次 404 后不再重试),不报错、不刷屏 console。
// 文件格式建议 mp3(兼容性最佳)或 ogg(体积更小)。详见 public/sounds/README.md。

/**
 * 音效标识符 → 资源 URL 映射。
 *
 * 下表列出引擎中已配置(或未来会配置)的所有 sound 标识符。
 * 每个标识符指向约定路径 `/sounds/{id}.mp3`(Vite 会把 public/ 下的文件映射到根路径)。
 *
 * | 标识符           | 语义                                   | 触发 atom / 派生事件                              |
 * |-----------------|----------------------------------------|---------------------------------------------------|
 * | play_card       | 打出/拼点扣置(牌扣到桌面)              | 声明打出时 / 拼点扣置 / 扣牌 / 移动牌→打出          |
 * | flip            | 翻牌(拼点亮出/蛊惑展示)                | 拼点亮出 / 展示                                    |
 * | target          | 指定/成为目标(高亮提示)               | 使用时 / 指定目标 / 成为目标 / 选择目标时 等        |
 * | damage_physical | 扣减体力(受物理伤害)                  | 扣减体力 / 造成伤害                                |
 * | heal            | 回复体力                               | 回复体力                                           |
 * | lose_health     | 失去体力(非伤害型)                    | 失去体力                                           |
 * | judge           | 判定翻牌                               | 判定                                               |
 * | death           | 角色死亡                               | 死亡时 / 系统处理牌 / 击杀                         |
 * | discard         | 弃牌                                   | 弃置 / 移动牌→弃牌 / 移出至暂存区                   |
 * | draw            | 摸牌                                   | 摸牌 / 移动牌→摸牌 / 归还暂存牌 / 置创牌            |
 * | unequip         | 卸下装备                               | 卸下                                               |
 * | mark            | 加/去标记                              | 加标记 / 去标记                                    |
 * | turn_start      | 回合开始                               | 回合开始                                           |
 * | turn_end        | 回合结束                               | 回合结束                                           |
 * | transform       | 转化(丈八蛇矛/武圣当杀)              | 当作                                               |
 * | pindian         | 拼点(旧 atom)                        | 拼点                                               |
 * | card_place      | 整理牌堆                               | 整理牌堆                                           |
 * | shuffle         | 洗牌/重洗                              | 洗牌 / 重洗                                        |
 * | judge_attach    | 添加延时锦囊(乐不思蜀/闪电等)        | 添加延时锦囊                                       |
 * | judge_remove    | 移除延时锦囊                           | 移除延时锦囊                                       |
 * | skill_add       | 添加技能                               | 添加技能                                           |
 * | skill_remove    | 移除技能                               | 移除技能                                           |
 * | give            | 给予(给牌)                           | 给予                                               |
 * | obtain          | 获得(从他人/牌堆获得牌)              | 获得                                               |
 * | equip           | 装备                                   | 装备                                               |
 * | chain          | 铁索连环(横置)                       | 设横置                                             |
 * | slash_request   | 询问杀(被要求出杀)                   | 询问杀                                             |
 * | dodge_request   | 询问闪(被要求出闪)                   | 询问闪                                             |
 * | phase_start     | 阶段开始                               | 阶段开始                                           |
 * | phase_end       | 阶段结束                               | 阶段结束                                           |
 * | dying          | 陷入濒死                               | 陷入濒死                                           |
 */
export const SOUND_MAP: Readonly<Record<string, string>> = {
  // ─── 卡牌操作 ───
  play_card: '/sounds/play_card.mp3',
  flip: '/sounds/flip.mp3',
  target: '/sounds/target.mp3',
  draw: '/sounds/draw.mp3',
  discard: '/sounds/discard.mp3',
  give: '/sounds/give.mp3',
  obtain: '/sounds/obtain.mp3',
  pindian: '/sounds/pindian.mp3',
  card_place: '/sounds/card_place.mp3',
  shuffle: '/sounds/shuffle.mp3',
  // ─── 体力/伤害 ───
  damage_physical: '/sounds/damage_physical.mp3',
  heal: '/sounds/heal.mp3',
  lose_health: '/sounds/lose_health.mp3',
  dying: '/sounds/dying.mp3',
  death: '/sounds/death.mp3',
  // ─── 装备/标记 ───
  equip: '/sounds/equip.mp3',
  unequip: '/sounds/unequip.mp3',
  mark: '/sounds/mark.mp3',
  chain: '/sounds/chain.mp3',
  // ─── 判定 ───
  judge: '/sounds/judge.mp3',
  judge_attach: '/sounds/judge_attach.mp3',
  judge_remove: '/sounds/judge_remove.mp3',
  // ─── 技能 ───
  skill_add: '/sounds/skill_add.mp3',
  skill_remove: '/sounds/skill_remove.mp3',
  transform: '/sounds/transform.mp3',
  // ─── 回合/阶段 ───
  turn_start: '/sounds/turn_start.mp3',
  turn_end: '/sounds/turn_end.mp3',
  phase_start: '/sounds/phase_start.mp3',
  phase_end: '/sounds/phase_end.mp3',
  // ─── 询问 ───
  slash_request: '/sounds/slash_request.mp3',
  dodge_request: '/sounds/dodge_request.mp3',
};

/**
 * 根据 sound 标识符解析资源 URL。
 * 未在映射表中登记的标识符返回 null(调用方应跳过)。
 */
export function resolveSoundUrl(soundId: string): string | null {
  return SOUND_MAP[soundId] ?? null;
}
