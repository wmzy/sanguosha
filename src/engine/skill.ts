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
  HookResult,
  Json,
  Skill,
} from './types';

export interface SkillModule {
  createSkill: (id: string, ownerId: number) => Skill;
  /** 注册时拿到 skill + ownerId(per player instance);内部直接 import 注册函数 */
  onInit?: (skill: Skill, ownerId: number) => (() => void) | void;
  onMount?: (skill: Skill, api: FrontendAPI) => (() => void) | void;
  /** 技能实例被创建时同步调用,可基于当前 state 初始化持续效果(如设 player.vars)。
   *  在 onInit 之后执行。与 onInit 的区别:onInit 只能注册 hook(无法直接操作 state),
   *  而 onInstantiate 拿到 state,适合装备类技能(马匹等)在装备当帧立即生效。
   *  对应清理在 onDestroy(由 unloadSkillInstance 调用)。 */
  onInstantiate?: (state: GameState, ownerId: number) => void;
  /** 技能实例被卸载时同步调用,清理 onInstantiate 设置的持续效果(如清 player.vars)。
   *  在 hook/action 注销之前执行。 */
  onDestroy?: (state: GameState, ownerId: number) => void;
}

// ─── module 查询 ───────────────────────────────────────────

/**
 * 技能模块解析器。由 skills/index.ts 设置,打破循环依赖
 * (技能文件 import skill.ts → skill.ts 不能反向 import skills/index.ts)。
 */
let skillModuleResolver: ((id: string) => Promise<SkillModule>) | null = null;

export function setSkillModuleResolver(fn: (id: string) => Promise<SkillModule>): void {
  skillModuleResolver = fn;
}

/** 通过解析器查找技能模块(动态 import,按需加载)。加载后缓存,供 getCachedSkillModule 同步获取。 */
const moduleCache = new Map<string, SkillModule>();

export async function getSkillModule(id: string): Promise<SkillModule> {
  const cached = moduleCache.get(id);
  if (cached) return cached;
  if (!skillModuleResolver) throw new Error('skillModuleResolver not set (forgot to import skills/index?)');
  const mod = await skillModuleResolver(id);
  moduleCache.set(id, mod);
  return mod;
}

/** 同步获取已加载过的技能模块(未加载返回 undefined)。用于 onDestroy 等必须在卸载时同步查模块的场景。 */
export function getCachedSkillModule(id: string): SkillModule | undefined {
  return moduleCache.get(id);
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
  // 同实例的 before/after hook 也必须清理,否则 instantiateSkill 重注册时
  // 老 hook 仍挂在全局表里,与新 hook 同时触发 → 重复结算(隐性的全局污染)。
  for (const list of [beforeHooks, afterHooks]) {
    for (const [atomType, arr] of list) {
      const filtered = arr.filter((e) => !(e.skillId === skillId && e.ownerId === ownerId));
      if (filtered.length === 0) list.delete(atomType);
      else if (filtered.length !== arr.length) list.set(atomType, filtered);
    }
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
  rollback?: (state: GameState, params: Record<string, Json>) => void,
): () => void {
  const entry: ActionEntry = { skillId, ownerId, actionType, validate, execute, rollback };
  registerActionEntry(entry);
  return () => unregisterActionEntry(skillId, ownerId, actionType);
}

/**
 * 注册一个 before atom 钩子。ownerId 在注册时绑定,handler 通过 ctx.ownerId 拿(无需闭包)。
 * before 钩子可返回 HookResult(pass/modify/cancel),after 钩子返回 void。
 */
export function registerBeforeHook(
  skillId: string,
  ownerId: number,
  atomType: string,
  handler: (ctx: AtomBeforeContext) => Promise<HookResult | void>,
): () => void {
  const entry: AtomHookEntry = { skillId, ownerId, atomType, phase: 'before', handler };
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
  const entry: AtomHookEntry = { skillId, ownerId, atomType, phase: 'after', handler };
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

export function unloadSkillInstance(skillId: string, ownerId: number, state?: GameState): void {
  const key = instanceKey(skillId, ownerId);
  // 先调 onDestroy 清理持续效果(如马匹 vars),此时模块还能查到
  if (state) {
    // 不走 getSkillModule(异步):模块可能已加载过,直接尝试同步获取缓存。
    // onDestroy 只在实例存在时调,而实例存在意味着模块已加载过。
    let mod: SkillModule | undefined;
    try { mod = getCachedSkillModule(skillId); } catch { mod = undefined; }
    mod?.onDestroy?.(state, ownerId);
  }
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

// ─── skill 注册 ─────────────────────────────────────────────

/** 遍历 state.players,给每个 skill 调 onInit 注册实例(并保存 unload)。
 *  bootstrap 用此在 开局 流程注入 player.skills 后注册;测试用此给预构造 state 注册技能。 */
export async function registerSkillsFromState(state: GameState): Promise<void> {
  for (const player of state.players) {
    for (const skillId of player.skills) {
      await instantiateSkill(skillId, player.index, state);
    }
  }
}

/**
 * 实例化单个 skill(从 create-engine bootstrap / registerSkillsFromState / 添加技能 atom 调用)。
 *
 * 幂等:若 (skillId, ownerId) 已有实例,先卸载旧实例(调其 unload 函数 + 清 action/hook 注册),
 * 再重新注册。保证 registerSkillsFromState 重入、并发 dispatch、动态 添加技能 等场景不会因
 * `registerActionEntry` 的 "already registered" 抛错。
 */
export async function instantiateSkill(skillId: string, ownerId: number, state?: GameState): Promise<Skill | null> {
  // 先卸载已有实例(若存在),释放其 action/hook 注册,避免重复注册抛错
  unloadSkillInstance(skillId, ownerId, state);
  let module;
  try {
    module = await getSkillModule(skillId);
  } catch {
    // 技能模块未注册(如候选人 skills 中的描述性名称):跳过,不中断开局流程
    return null;
  }
  const skill = module.createSkill(skillId, ownerId);
  if (module.onInit) {
    const unload = module.onInit(skill, ownerId);
    setSkillInstanceUnload(skillId, ownerId, typeof unload === 'function' ? unload : () => {});
  }
  // onInstantiate:基于当前 state 同步初始化持续效果(马匹 vars 等)。
  // 在 onInit 之后执行,此时 hook/action 已注册。
  if (state && module.onInstantiate) {
    module.onInstantiate(state, ownerId);
  }
  return skill;
}
