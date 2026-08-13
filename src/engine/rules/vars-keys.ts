// 跨技能 vars 键名常量集中定义。
//
// 引擎三个 vars 字典均为 Record<string, Json>:
//   state.localVars / state.turn.vars / state.players[i].vars
// 当技能 A 写入某 key、技能 B 读取同 key 时即构成跨技能隐式契约。
// 拼错 key 字符串会静默失效(无编译期检查)。
// 本文件集中定义这些跨技能 key 常量与拼接 helper,消除散落的字符串字面量。
//
// 只收敛 key 字符串本身,不改 value 类型/语义。
// 局部 key(仅单文件读写)不收入此文件,避免过度收敛。

// ── turn.vars:回合内计数(回合结束 atom 自动清空) ──────────

/** 本回合奇制发动次数。写:奇制.ts;读:进趋.ts。 */
export const QIZHI_COUNT_KEY = '奇制/count';

/** 出杀额定已用次数。读写:rules/slash-quota.ts。 */
export const SLASH_QUOTA_USED_KEY = '杀/quotaUsed';
/** 出杀额外已用次数。读写:rules/slash-quota.ts。 */
export const SLASH_EXTRA_USED_KEY = '杀/extraUsed';

// ── player.vars:持久标记(整局或条件驱动) ──────────────────

/** 魂姿觉醒标记(整局一次)。写:魂姿.ts/界魂姿.ts;读:制霸.ts/界制霸.ts。 */
export const HUNZI_AWAKENED_KEY = '魂姿/awakened';

/** 化身牌池(string[])。写:化身.ts;读/写:新生.ts。 */
export const HUASHEN_POOL_KEY = '化身/牌池';

/** 兵略已触发的飞军目标列表(number[],整局持久)。读写:飞军.ts。 */
export const BINGLUE_TARGETS_KEY = '兵略/已飞军目标';

// ── player.vars:距离修正(正值语义见 distance.ts) ──────────

/** 进攻距离修正(正值=缩短距离)。写:马术/屯田/急袭/界屯田/界义从/马匹技能;读:distance.ts, buildView.ts。 */
export const DISTANCE_ATTACK_MOD_KEY = '距离/进攻修正';
/** 防御距离修正(正值=增加距离)。写:马匹技能/界义从;读:distance.ts, buildView.ts。 */
export const DISTANCE_DEFENSE_MOD_KEY = '距离/防御修正';
/** 出杀范围(武器攻击范围,默认 1)。写:装备/卸下/移出至暂存区 atom;读:distance.ts, buildView.ts, 多技能回滚。 */
export const DISTANCE_ATTACK_RANGE_KEY = '距离/出杀范围';

// ── localVars:选牌面板结果 ─────────────────────────────────

/** 选牌面板结果({ zone, cardId, handIndex })。读:flows/pick-card-panel.ts;写:10+ 技能/cards。 */
export const PICK_RESULT_KEY = '选牌/结果';

// ── helpers:带后缀/前缀的拼接 key ──────────────────────────

/**
 * 秘计挂起标记 key:界贞烈选项②写入,界秘计结束阶段消费(跨回合持久,存 player.vars)。
 * 写:界贞烈.ts;读:界秘计.ts。
 */
export function mijiPendingKey(ownerId: number): string {
  return `秘计/pendingFrom贞烈/${ownerId}`;
}

/**
 * 手牌上限加成 key:存 turn.vars(回合结束自动清空)。
 * 写:决堰/界集智/界精策;读:rules/hand-limit.ts(默认公式 health + bonus)+ 多技能覆盖 provider。
 */
export function handLimitBonusKey(player: number): string {
  return `手牌上限/bonus:${player}`;
}
