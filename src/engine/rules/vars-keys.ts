// 跨技能 vars 键名常量 + value 类型 + typed accessor 集中定义。
//
// 引擎三个 vars 字典均为 Record<string, Json>:
//   state.localVars / state.turn.vars / state.players[i].vars
// 当技能 A 写入某 key、技能 B 读取同 key 时即构成跨技能隐式契约。
// 拼错 key 字符串会静默失效(无编译期检查)。
// 本文件集中定义这些跨技能 key 常量与拼接 helper,消除散落的字符串字面量。
//
// 只收敛 key 字符串本身,不改 value 类型/语义。
// 局部 key(仅单文件读写)不收入此文件,避免过度收敛。

import type { Json } from '../types';

// ── value 类型(跨技能 key 的契约值类型) ─────────────────────

/** 选牌面板结果。由 过河拆桥/顺手牵羊/反馈/寒冰剑/奇制/... 写入,flows/pick-card-panel 读取。 */
export interface PickResult {
  zone: string;
  cardId: string | null;
  handIndex: number | null;
}

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

// ── typed accessor:value 类型收敛 + undefined 兜底 ──────────
//
// 跨技能 vars 读点原本散落 `(vars[KEY] as T) ?? 默认`,依赖人肉保证 value 形状。
// 下列 getter 把 `as`/运行时收窄收敛到此处:返回值已是窄类型,缺失或形状不符返回 undefined,
// 调用方照旧用 `?? 默认` 兜底(语义不变)。写入仍可直接 `vars[KEY] = value`(value 本身已是 Json)。

/** 读取并按 T 断言 vars[key];缺失返回 undefined。仅作 escape hatch,优先用下方 per-key getter。 */
export function getVar<T extends Json>(vars: Record<string, Json> | undefined, key: string): T | undefined {
  return vars?.[key] as T | undefined;
}

/** 类型化写入。 */
export function setVar(vars: Record<string, Json>, key: string, value: Json): void {
  vars[key] = value;
}

function asNumber(v: Json | undefined): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function asBoolean(v: Json | undefined): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}
function asStringArray(v: Json | undefined): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;
}
function asNumberArray(v: Json | undefined): number[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : undefined;
}

// 距离修正(player.vars,number)
/** 距离/进攻修正(默认 0)。正值=缩短距离(进攻马/马术/屯田/急袭)。 */
export function getDistanceAttackMod(vars: Record<string, Json> | undefined): number | undefined {
  return asNumber(vars?.[DISTANCE_ATTACK_MOD_KEY]);
}
/** 距离/防御修正(默认 0)。正值=增加距离(防御马)。 */
export function getDistanceDefenseMod(vars: Record<string, Json> | undefined): number | undefined {
  return asNumber(vars?.[DISTANCE_DEFENSE_MOD_KEY]);
}
/** 距离/出杀范围(默认 1)。武器攻击范围,徒手为 1。 */
export function getDistanceAttackRange(vars: Record<string, Json> | undefined): number | undefined {
  return asNumber(vars?.[DISTANCE_ATTACK_RANGE_KEY]);
}

// 手牌上限加成(turn.vars,number,默认 0)
/** 手牌上限/bonus:<player>(回合内,回合结束自动清空)。 */
export function getHandLimitBonus(turnVars: Record<string, Json> | undefined, player: number): number | undefined {
  return asNumber(turnVars?.[handLimitBonusKey(player)]);
}

// 持久标记(player.vars)
/** 魂姿/awakened(整局一次,boolean)。 */
export function getHunziAwakened(vars: Record<string, Json> | undefined): boolean | undefined {
  return asBoolean(vars?.[HUNZI_AWAKENED_KEY]);
}
/** 化身/牌池(string[],默认 [])。 */
export function getHuashenPool(vars: Record<string, Json> | undefined): string[] | undefined {
  return asStringArray(vars?.[HUASHEN_POOL_KEY]);
}
/** 兵略/已飞军目标(number[],默认 [])。 */
export function getBinglueTargets(vars: Record<string, Json> | undefined): number[] | undefined {
  return asNumberArray(vars?.[BINGLUE_TARGETS_KEY]);
}
/** 秘计/pendingFrom贞烈/<ownerId>(player.vars,boolean)。 */
export function getMijiPending(vars: Record<string, Json> | undefined, ownerId: number): boolean | undefined {
  return asBoolean(vars?.[mijiPendingKey(ownerId)]);
}

// 回合计数(turn.vars,number,默认 0)
/** 奇制/count(本回合奇制发动次数)。 */
export function getQizhiCount(turnVars: Record<string, Json> | undefined): number | undefined {
  return asNumber(turnVars?.[QIZHI_COUNT_KEY]);
}
/** 杀/quotaUsed(本回合额定已用次数)。 */
export function getSlashQuotaUsed(turnVars: Record<string, Json> | undefined): number | undefined {
  return asNumber(turnVars?.[SLASH_QUOTA_USED_KEY]);
}
/** 杀/extraUsed(本回合额外已用次数)。 */
export function getSlashExtraUsed(turnVars: Record<string, Json> | undefined): number | undefined {
  return asNumber(turnVars?.[SLASH_EXTRA_USED_KEY]);
}

// 选牌面板结果(localVars)
/** 选牌/结果(PickResult)。形状不符返回 undefined(消费端据此走默认选择)。 */
export function getPickResult(localVars: Record<string, Json> | undefined): PickResult | undefined {
  const v = localVars?.[PICK_RESULT_KEY];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const obj = v as Record<string, Json>;
  if (typeof obj.zone !== 'string') return undefined;
  if (obj.cardId !== null && typeof obj.cardId !== 'string') return undefined;
  if (obj.handIndex !== null && typeof obj.handIndex !== 'number') return undefined;
  return v as unknown as PickResult;
}
