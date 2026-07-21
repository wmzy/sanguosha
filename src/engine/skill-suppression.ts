// 非锁定技失效扩展点——查询型提供者模式(与 slash-quota/hand-limit 同构)。
//
// "非锁定技失效"类效果(义绝/界铁骑/界完杀):令目标的非锁定技 hook 不触发。
// 引擎核心 create-engine.applyAtom 在跑 before/after hooks 时,对每个 hook
// 查询 isHookSuppressed:若任一 provider 返回 true 则跳过该 hook。
//
// 优势:
//   - 引擎核心不硬编码技能名/标签白名单(SUPPRESSION_TAGS 已移除)。
//   - 各技能自行注册 predicate,predicate 内部读自己的 tag/vars 判定。
//   - 多技能天然叠加(义绝+界铁骑同时命中一个目标,各自 predicate 返回 true)。
//
// "锁定技"判定:由 Skill.isLocked 字段(skill 模块自行声明)决定。
// 引擎通过 skillModuleResolver 获取 skill 的 isLocked,不解析描述字符串。
//
// 注册表为 state-bound(WeakMap 外挂在 GameState 上),随 state 自动隔离与 GC,
// 无模块级全局状态泄漏(与 skill.ts / slash-quota.ts 的 registries 同构)。
//
// 与 slash-quota 的区别:suppression provider 不按 ownerId 桶化。
//   压制关系是"owner(界马超) → target(其他玩家)"——provider 注册者是发动压制的
//   技能 owner,但被查的是 target。若按 target 桶化,provider 必须注册到每个可能的
//   target,实例化时无人知道将来会被谁压制。故采用单一全局 provider 集合,
//   每次 isHookSuppressed 遍历所有 provider,由 provider 自行在 predicate 内
//   判定是否命中。数量极少(全局几个技能),遍历成本可忽略。

import type { GameState } from './types';
import { getCachedSkillModule } from './skill';

/**
 * 非锁定技失效判定器:返回 true 表示该 owner 的此技能 hook 应被跳过。
 *  ownerId 为 hook 归属者(被压制的玩家),skillId 为 hook 来源技能 loader key。
 *  注册时传入的 ownerId 是发动压制的技能 owner(如界马超),仅用于生命周期管理。
 */
export type SuppressionProvider = (
  state: GameState,
  ownerId: number,
  skillId: string,
) => boolean;

interface SuppressionRegistry {
  /** 全局 provider 集合(不按 owner 桶化,原因见文件头注释) */
  providers: Set<SuppressionProvider>;
}

const suppressionRegistries = new WeakMap<GameState, SuppressionRegistry>();

function getSuppressionRegistry(state: GameState): SuppressionRegistry {
  let reg = suppressionRegistries.get(state);
  if (!reg) {
    reg = { providers: new Set() };
    suppressionRegistries.set(state, reg);
  }
  return reg;
}

/**
 * 注册一个非锁定技失效判定器(技能 onInit 时调用,与 registerSlashBlocker 同构)。
 * 返回的取消注册函数应并入 onInit 返回的 unload,由 setSkillInstanceUnload 统一清理。
 * provider 加入全局集合(不按 owner 桶化,原因见文件头注释),生命周期由技能实例卸载管理。
 */
export function registerSuppressionProvider(
  state: GameState,
  provider: SuppressionProvider,
): () => void {
  const reg = getSuppressionRegistry(state);
  reg.providers.add(provider);
  return () => {
    reg.providers.delete(provider);
  };
}

/**
 * 判定某 owner 的某技能 hook 是否被压制。
 *   - 系统级(ownerId===TARGET_SYSTEM)永不压制。
 *   - 锁定技/防具/武器(Skill.isLocked=true)永不压制——规则:锁定技不受"非锁定技失效"影响。
 *   - 其余情况查 provider 集合,任一返回 true 即压制。
 * 无法解析技能模块时保守不压制(避免误吞未知技能)。
 */
export function isHookSuppressed(
  state: GameState,
  ownerId: number,
  skillId: string,
): boolean {
  if (ownerId < 0) return false; // TARGET_SYSTEM / TARGET_BROADCAST
  // 从已加载模块查 isLocked:技能自行声明,引擎不解析描述字符串。
  // createSkill 同步且确定性(isLocked 对每个技能固定),缓存 lookup 即可。
  // 不走 instantiateSkill 的副作用路径——仅取元数据。
  const mod = getCachedSkillModule(skillId);
  if (mod) {
    try {
      const sample = mod.createSkill(skillId, ownerId);
      if (sample.isLocked) return false;
    } catch {
      // 模块 createSkill 抛错属实现 bug,保守不压制(上层 onError 会捕获真实错误)。
    }
  }
  const set = getSuppressionRegistry(state).providers;
  for (const fn of set) {
    if (fn(state, ownerId, skillId)) return true;
  }
  return false;
}
