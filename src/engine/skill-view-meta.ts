// src/engine/skill-view-meta.ts
// 技能视图元数据静态注册表(引擎核心,不属于 skills/)。
//
// 背景:某些技能(如马匹技能)的视图同步数据在 onInit(after-hook)里才写入 state,
// 但 atom 的 toViewEvents 在 after-hook **之前**执行。通用 atom 需要在 toViewEvents
// 阶段就能查到这些静态视图增量,才能预先塞进 ViewEvent、让 applyView 同步视图。
//
// 解耦:此前 添加技能/移除技能 这两个通用 atom 硬编码 import 了 skills/马匹技能.ts
// 的 MOUNT_DISTANCE_VARS 表(违反"通用 atom 不依赖具体技能")。改用本注册表后:
//   - 马匹技能.ts 在模块加载时通过 registerSkillViewDelta 注册静态增量
//   - 通用 atom 通过 getSkillViewDelta 查询,不再 import skills/

/** 技能的静态视图增量。 */
export interface SkillViewDelta {
  /** 马匹距离修正增量(添加技能时同步到 view.distanceVars)。
   *  进攻马→attackMod,防御马→defenseMod。 */
  mountDistanceVars?: { attackMod?: number; defenseMod?: number };
}

/**
 * 模块级静态注册表:skillId → 视图增量。
 * 纯静态(马匹技能的 distanceVars 不随 state 变化),故无需 state-bound 绑定。
 * 仅通过 registerSkillViewDelta / getSkillViewDelta 访问,不直接暴露。
 */
const skillViewDeltas = new Map<string, SkillViewDelta>();

/** 注册技能的静态视图增量(技能模块加载时调用)。 */
export function registerSkillViewDelta(skillId: string, delta: SkillViewDelta): void {
  skillViewDeltas.set(skillId, delta);
}

/** 查询技能的静态视图增量(通用 atom 的 toViewEvents 调用)。 */
export function getSkillViewDelta(skillId: string): SkillViewDelta | undefined {
  return skillViewDeltas.get(skillId);
}
