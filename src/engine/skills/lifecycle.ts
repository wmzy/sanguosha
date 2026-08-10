// skills/lifecycle.ts — 技能模块加载 + 实例生命周期管理。
//
// 从 core/skill.ts 迁出:这些函数依赖 skillLoaders（技能模块表）和 cardEffectMap
// （卡名判断），两者都在 skills/ 层。放在 core 会被迫发明 setter（service locator）
// 跨层获取数据——本文件直接 import，消除 3 个全局可变 setter：
//   setSkillModuleResolver / setSkillModuleChecker / setCardNameChecker
//
// 依赖方向（单向 DAG）:
//   skills/lifecycle.ts → core/skill.ts      (注册表 CRUD)
//   skills/lifecycle.ts → skills/index.ts    (skillLoaders)
//   skills/lifecycle.ts → skills/cards       (hasCardEffect)
//
// core/skill.ts 不感知 skills/ 的存在（纯注册表 + state-bound 操作）。

import type { SkillModule, Skill, GameState } from '../types';
import {
  setSkillInstanceUnload,
  getSkillInstanceUnload,
  deleteSkillInstanceUnload,
  unregisterActionsForInstance,
  setSkillLocked,
} from '../core/skill';
import { skillLoaders } from './index';
import { hasCardEffect } from './cards';

// ─── moduleCache ───────────────────────────────────────────

const moduleCache = new Map<string, SkillModule>();

let moduleCacheVersion = 0;
const moduleCacheListeners = new Set<() => void>();

export function subscribeModuleCache(cb: () => void): () => void {
  moduleCacheListeners.add(cb);
  return () => {
    moduleCacheListeners.delete(cb);
  };
}

export function getModuleCacheVersion(): number {
  return moduleCacheVersion;
}

export async function getSkillModule(id: string): Promise<SkillModule> {
  const cached = moduleCache.get(id);
  if (cached) return cached;
  const loader = skillLoaders[id];
  if (!loader) throw new Error(`Skill module "${id}" not found in skillLoaders`);
  const mod = await loader();
  moduleCache.set(id, mod);
  moduleCacheVersion++;
  moduleCacheListeners.forEach((cb) => cb());
  return mod;
}

/** 同步检查技能模块是否已注册（在 skillLoaders 中）。
 *  用于跳过未注册的技能 id（如已删除的 per-card 技能），避免 getSkillModule 拑错。 */
export function isSkillModuleRegistered(id: string): boolean {
  return id in skillLoaders;
}

export function getCachedSkillModule(id: string): SkillModule | undefined {
  return moduleCache.get(id);
}

// ─── 技能描述查询(静态数据,前端 tooltip / MCP 工具共享) ─────────
// createSkill 返回的 description 不依赖 ownerId(每个技能固定文案),
// 故用 ownerId=0 取一次并缓存,供前端 hover tip 与 MCP getSkillInfo 复用,
// 避免在多处重复硬编码或重复调用 createSkill。
const descriptionCache = new Map<string, string>();

/** 同步获取技能描述。依赖技能模块已加载(moduleCache 命中);未加载返回 undefined。
 *  前端 useSkillActions 在 view 变化时为所有玩家 registerSkillActions → 全量加载技能模块,
 *  故渲染时基本能命中;首次渲染(effect 未跑完)的极少数情况优雅降级(只显示技能名)。
 *  需要确保命中的场景(MCP 工具/服务端)用 getSkillDescriptionAsync。 */
export function getSkillDescription(id: string): string | undefined {
  if (descriptionCache.has(id)) return descriptionCache.get(id);
  const mod = moduleCache.get(id);
  if (!mod) return undefined;
  try {
    const desc = mod.createSkill(id, 0).description;
    descriptionCache.set(id, desc);
    return desc;
  } catch {
    return undefined;
  }
}

/** 异步获取技能描述:先查缓存,未命中则加载模块再取。模块缺失(无对应技能)返回 undefined。 */
export async function getSkillDescriptionAsync(id: string): Promise<string | undefined> {
  if (descriptionCache.has(id)) return descriptionCache.get(id);
  try {
    await getSkillModule(id);
  } catch {
    return undefined;
  }
  return getSkillDescription(id);
}

// ─── 实例生命周期 ──────────────────────────────────────────

export function unloadSkillInstance(state: GameState, skillId: string, ownerId: number): void {
  const unload = getSkillInstanceUnload(state, skillId, ownerId);
  if (unload) {
    unload();
    deleteSkillInstanceUnload(state, skillId, ownerId);
  }
  // 按前缀清理残留 action/hook。但跳过卡名同名技能（如铁索连环）：
  // 使用牌/打出牌 按卡名注册 use/respond action（skillId=卡名），
  // 若此处按前缀清理会误删这些由 使用牌 注册的 action。
  // 卡名同名技能的 action 清理由其自身 unload 函数精确处理。
  if (!hasCardEffect(skillId)) {
    unregisterActionsForInstance(state, skillId, ownerId);
  }
}

export async function registerSkillsFromState(state: GameState): Promise<void> {
  // 顺序实例化(按座次 + skills 数组序),保证 after/before hook 的注册顺序确定。
  // 此前用 Promise.all 并发,模块缓存命中时各 instantiateSkill 的 onInit 执行顺序
  // 由微任务调度决定——会导致依赖注册顺序的技能(如鬼才须先于闪电注册才能改判)
  // 在并发调度下顺序反转。与 开局.ts 中既有的 for-await 实例化模式保持一致。
  for (const player of state.players) {
    for (const skillId of player.skills) {
      await instantiateSkill(state, skillId, player.index);
    }
  }
}

/**
 * 实例化单个 skill(从 index bootstrap / registerSkillsFromState / 添加技能 atom 调用)。
 *
 * 幂等:若 (skillId, ownerId) 已有实例,先卸载旧实例(调其 unload 函数 + 清 action/hook 注册),
 * 再重新注册。保证 registerSkillsFromState 重入、并发 dispatch、动态 添加技能 等场景不会因
 * `registerActionEntry` 的 "already registered" 抛错。
 */
export async function instantiateSkill(
  state: GameState,
  skillId: string,
  ownerId: number,
): Promise<Skill | null> {
  // 仅当技能模块存在时才卸载——否则会误删 使用牌/打出牌 按卡名注册的 action
  // （如 player.skills 含 '无中生有' 但该模块已删除，其 action 由 使用牌 注册）。
  if (!isSkillModuleRegistered(skillId)) return null;
  unloadSkillInstance(state, skillId, ownerId);
  const module = await getSkillModule(skillId);
  const skill = module.createSkill(skillId, ownerId);
  if (module.onInit) {
    const unload = module.onInit(skill, state);
    setSkillInstanceUnload(
      state,
      skillId,
      ownerId,
      typeof unload === 'function' ? unload : () => {},
    );
  }
  // 写入 isLocked 元数据供 skill-suppression 查询（替代旧 getCachedSkillModule 反射查询）。
  setSkillLocked(state, skillId, skill.isLocked ?? false);
  return skill;
}
