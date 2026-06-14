// src/engine/skill.ts
// action/hook 实例注册 + 实例管理(全部顶层函数式 API)。
//
// skill 直接 import 以下函数使用:
//   - registerAction(skillId, ownerId, actionType, validate, execute)
//   - registerBeforeHook(skillId, ownerId, atomType, handler)
//   - registerAfterHook(skillId, ownerId, atomType, handler)
//   - 对应的 unregisterXxx 配套

import type {
  ActionEntry,
  AtomAfterContext,
  AtomBeforeContext,
  AtomHookEntry,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from './types';

export interface SkillModule {
  createSkill: (id: string, ownerId: number) => Skill;
  /** 注册时拿到 skill + ownerId(per player instance);内部直接 import 注册函数 */
  onInit?: (skill: Skill, ownerId: number) => (() => void) | void;
  onMount?: (skill: Skill, api: FrontendAPI) => (() => void) | void;
}

// ─── module 查询 ───────────────────────────────────────────

/** 通过 skillLoaders 动态 import 获取技能模块 */
export async function getSkillModule(id: string): Promise<SkillModule> {
  const { skillLoaders } = await import('./skills/index');
  const loader = skillLoaders[id];
  if (!loader) throw new Error(`Skill module "${id}" not found in skillLoaders`);
  return loader();
}

// ─── 实例级注册表(action + hook) ──────────────────────────────

const actions = new Map<string, ActionEntry>();
const beforeHooks = new Map<string, AtomHookEntry[]>();
const afterHooks = new Map<string, AtomHookEntry[]>();

function actionKey(skillId: string, ownerId: number, actionType: string): string {
  return `${skillId}:${ownerId}:${actionType}`;
}

export function registerActionEntry(entry: ActionEntry): void {
  const k = actionKey(entry.skillId, entry.ownerId, entry.actionType);
  if (actions.has(k)) throw new Error(`Action "${k}" already registered`);
  actions.set(k, entry);
}

export function findActionEntry(skillId: string, ownerId: number, actionType: string): ActionEntry | undefined {
  return actions.get(actionKey(skillId, ownerId, actionType));
}

export function unregisterActionEntry(skillId: string, ownerId: number, actionType: string): void {
  actions.delete(actionKey(skillId, ownerId, actionType));
}

function unregisterActionsForInstance(skillId: string, ownerId: number): void {
  const prefix = `${skillId}:${ownerId}:`;
  for (const key of [...actions.keys()]) {
    if (key.startsWith(prefix)) actions.delete(key);
  }
}

export function getBeforeHooks(atomType: string): AtomHookEntry[] {
  return beforeHooks.get(atomType) ?? [];
}

export function getAfterHooks(atomType: string): AtomHookEntry[] {
  return afterHooks.get(atomType) ?? [];
}

// ─── 顶层注册 helper(skill 在 onInit 内直接调用) ─────────────

/**
 * 注册一个 action(主动出牌/使用技能/回应/开始等)。
 * 内部封装 registerActionEntry;返回 unloader。
 */
export function registerAction(
  skillId: string,
  ownerId: number,
  actionType: string,
  validate: (state: GameState, params: Record<string, Json>) => string | null,
  execute: (state: GameState, params: Record<string, Json>) => Promise<void>,
): () => void {
  const entry: ActionEntry = { skillId, ownerId, actionType, validate, execute };
  registerActionEntry(entry);
  return () => unregisterActionEntry(skillId, ownerId, actionType);
}

/**
 * 注册一个 before atom 钩子。ownerId 在注册时绑定,handler 通过 ctx.ownerId 拿(无需闭包)。
 */
export function registerBeforeHook(
  skillId: string,
  ownerId: number,
  atomType: string,
  handler: (ctx: AtomBeforeContext) => Promise<void>,
): () => void {
  const entry: AtomHookEntry = { skillId, ownerId, atomType, phase: 'before', handler: handler as AtomHookEntry['handler'] };
  const list = beforeHooks.get(atomType) ?? [];
  list.push(entry);
  beforeHooks.set(atomType, list);
  return () => {
    const arr = beforeHooks.get(atomType);
    if (!arr) return;
    const idx = arr.indexOf(entry);
    if (idx >= 0) arr.splice(idx, 1);
  };
}

/**
 * 注册一个 after atom 钩子。ownerId 在注册时绑定。
 */
export function registerAfterHook(
  skillId: string,
  ownerId: number,
  atomType: string,
  handler: (ctx: AtomAfterContext) => Promise<void>,
): () => void {
  const entry: AtomHookEntry = { skillId, ownerId, atomType, phase: 'after', handler: handler as AtomHookEntry['handler'] };
  const list = afterHooks.get(atomType) ?? [];
  list.push(entry);
  afterHooks.set(atomType, list);
  return () => {
    const arr = afterHooks.get(atomType);
    if (!arr) return;
    const idx = arr.indexOf(entry);
    if (idx >= 0) arr.splice(idx, 1);
  };
}

// ─── 实例管理 ──────────────────────────────────────────────

const instanceUnloads = new Map<string, () => void>();

function instanceKey(skillId: string, ownerId: number): string {
  return `${skillId}:${ownerId}`;
}

export function setSkillInstanceUnload(skillId: string, ownerId: number, unload: () => void): void {
  instanceUnloads.set(instanceKey(skillId, ownerId), unload);
}

export function unloadSkillInstance(skillId: string, ownerId: number): void {
  const key = instanceKey(skillId, ownerId);
  const unload = instanceUnloads.get(key);
  if (unload) {
    unload();
    instanceUnloads.delete(key);
  }
  unregisterActionsForInstance(skillId, ownerId);
}

export function clearAllSkillInstances(): void {
  for (const unload of instanceUnloads.values()) {
    unload();
  }
  instanceUnloads.clear();
  actions.clear();
  beforeHooks.clear();
  afterHooks.clear();
}

// ─── bootstrap / rebootstrap ────────────────────────────────

/** 遍历 state.players,给每个 skill 调 onInit 注册实例(并保存 unload) */
export async function rebootstrap(state: GameState): Promise<void> {
  for (const player of state.players) {
    for (const skillId of player.skills) {
      await instantiateSkill(skillId, player.index);
    }
  }
}

/**
 * 实例化单个 skill(从 create-engine bootstrap / rebootstrap / 添加技能 atom 调用)。
 *
 * 幂等:若 (skillId, ownerId) 已有实例,先卸载旧实例(调其 unload 函数 + 清 action/hook 注册),
 * 再重新注册。保证 rebootstrap 重入、并发 dispatch、动态 添加技能 等场景不会因
 * `registerActionEntry` 的 "already registered" 抛错。
 */
export async function instantiateSkill(skillId: string, ownerId: number): Promise<Skill> {
  // 先卸载已有实例(若存在),释放其 action/hook 注册,避免重复注册抛错
  unloadSkillInstance(skillId, ownerId);
  const module = await getSkillModule(skillId);
  const skill = module.createSkill(skillId, ownerId);
  if (module.onInit) {
    const unload = module.onInit(skill, ownerId);
    setSkillInstanceUnload(skillId, ownerId, typeof unload === 'function' ? unload : () => {});
  }
  return skill;
}
