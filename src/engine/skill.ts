// src/engine/skill.ts
// action/hook 实例注册 + 实例管理(state-bound 注册表)。
//
// 注册表通过 WeakMap 外挂在 GameState 上,实现 state 隔离 = 注册表隔离。
// 这消除了模块级全局状态导致的跨对局泄漏(如 流离 hook 残留错误触发)。
//
// skill 直接 import 以下函数使用(state 作为注册表句柄,首参):
//   - registerAction(state, skillId, ownerId, actionType, validate, execute)
//   - registerBeforeHook(state, skillId, ownerId, atomType, handler)
//   - registerAfterHook(state, skillId, ownerId, atomType, handler)
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
  PendingSlot,
  Skill,
} from './types';
import { TARGET_SYSTEM } from './types';

export interface SkillModule {
  createSkill: (id: string, ownerId: number) => Skill;
  /** 注册时拿到 skill + state;ownerId 从 skill.ownerId 取。
   *  返回卸载函数,由 unloadSkillInstance 调用清理(装备类技能如马匹在此设/清 vars)。 */
  onInit?: (skill: Skill, state: GameState) => (() => void) | void;
  onMount?: (skill: Skill, api: FrontendAPI) => (() => void) | void;
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

/** 同步检查技能模块是否注册。由 skills/index.ts 设置,用于避免 try-catch 控制流。 */
let skillModuleChecker: ((id: string) => boolean) | null = null;

export function setSkillModuleChecker(fn: (id: string) => boolean): void {
  skillModuleChecker = fn;
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

/** 同步获取已加载过的技能模块(未加载返回 undefined)。用于卸载时同步查模块的场景。 */
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

// ─── state-bound 注册表(WeakMap 外挂) ────────────────────────

interface SkillRegistry {
  actions: Map<string, ActionEntry>;
  beforeHooks: Map<string, AtomHookEntry[]>;
  afterHooks: Map<string, AtomHookEntry[]>;
  instanceUnloads: Map<string, () => void>;
}

/** state → 注册表的外挂映射。WeakMap 随 state 自动 GC,无需手动清理。 */
const registries = new WeakMap<GameState, SkillRegistry>();

/** 取(或懒创建)state 绑定的注册表。 */
function getRegistry(state: GameState): SkillRegistry {
  let r = registries.get(state);
  if (!r) {
    r = {
      actions: new Map(),
      beforeHooks: new Map(),
      afterHooks: new Map(),
      instanceUnloads: new Map(),
    };
    registries.set(state, r);
  }
  return r;
}

function actionKey(skillId: string, ownerId: number, actionType: string): string {
  return `${skillId}:${ownerId}:${actionType}`;
}

function instanceKey(skillId: string, ownerId: number): string {
  return `${skillId}:${ownerId}`;
}

// ─── pending slot / validateUseCard 等只读 helper(state 参数已有,无需改注册表) ───

/** 查找某玩家的活跃 pending slot。
 *  查找顺序:ownerId 精确匹配 → 广播型(target<TARGET_SYSTEM) → 唯一活跃 slot(兜底)。
 *  无匹配返回 undefined。 */
export function findPendingSlot(state: GameState, ownerId: number): PendingSlot | undefined {
  return state.pendingSlots.get(ownerId)
    ?? [...state.pendingSlots.values()].find(s => {
      const t = (s.atom as { target?: unknown }).target;
      return typeof t === 'number' && t < TARGET_SYSTEM;
    })
    ?? (state.pendingSlots.size === 1
      ? (() => {
          const slot = [...state.pendingSlots.values()][0];
          // size===1 fallback:只返回属于请求者的 slot,不能误匹配其他玩家的出牌窗口等非阻塞 pending
          const target = (slot.atom as { target?: number }).target
            ?? (slot.atom as { player?: number }).player;
          return typeof target === 'number' && target === ownerId ? slot : undefined;
        })()
      : undefined);
}

/** 是否存在阻塞型 pending——即需要玩家先回应的询问(询问闪/杀/无瓣/弃牌等)。
 *  非阻塞型 pending(出牌阶段的 出牌窗口)不阻止玩家出牌/用技,不计入此判断。
 *  判断依据是 slot.isBlocking 字段,由 atom 定义的 pending.isBlocking 声明。
 *  validateUseCard 和 end action 用此函数替代旧的 pendingSlots.size > 0 检查。 */
export function hasBlockingPending(state: GameState): boolean {
  for (const slot of state.pendingSlots.values()) {
    if (slot.isBlocking) return true;
  }
  return false;
}

/** 出牌阶段使用牌 action 的通用 validate,覆盖 90% 的 use 场景。
 *  检查:自己回合、出牌阶段、无阻塞型 pending、存活、手牌中有牌。
 *  返回 null=通过,字符串=拒绝理由。skills 可在此之上追加校验。
 *  @param opts.cardName 需要的卡牌名称。缺省则不校验牌名。
 *  @param opts.requireTarget 是否需要非空 targets 数组。缺省则不校验目标。 */
export function validateUseCard(
  state: GameState,
  ownerId: number,
  params: Record<string, Json>,
  opts?: { cardName?: string; requireTarget?: boolean },
): string | null {
  if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
  if (state.phase !== '出牌') return '不是出牌阶段';
  if (hasBlockingPending(state)) return '当前有等待响应';
  const self = state.players[ownerId];
  if (!self.alive) return '你已死亡';
  const cardId = params.cardId as string | undefined;
  if (!cardId) return 'cardId required';
  if (!self.hand.includes(cardId)) return '牌不在手牌中';
  if (opts?.cardName && state.cardMap[cardId]?.name !== opts.cardName) return `不是${opts.cardName}`;
  if (opts?.requireTarget) {
    const targets = params.targets as number[] | undefined;
    if (!Array.isArray(targets) || targets.length === 0) return 'target required';
  }
  return null;
}

// ─── 实例级注册表(action + hook,state-bound) ──────────────────

export function registerActionEntry(state: GameState, entry: ActionEntry): void {
  const k = actionKey(entry.skillId, entry.ownerId, entry.actionType);
  getRegistry(state).actions.set(k, entry);
}

export function findActionEntry(state: GameState, skillId: string, ownerId: number, actionType: string): ActionEntry | undefined {
  return getRegistry(state).actions.get(actionKey(skillId, ownerId, actionType));
}

export function unregisterActionEntry(state: GameState, skillId: string, ownerId: number, actionType: string): void {
  getRegistry(state).actions.delete(actionKey(skillId, ownerId, actionType));
}

function unregisterActionsForInstance(state: GameState, skillId: string, ownerId: number): void {
  const reg = getRegistry(state);
  const prefix = `${skillId}:${ownerId}:`;
  for (const key of [...reg.actions.keys()]) {
    if (key.startsWith(prefix)) reg.actions.delete(key);
  }
  // 同实例的 before/after hook 也必须清理,否则 instantiateSkill 重注册时
  // 老 hook 仍挂在注册表里,与新 hook 同时触发 → 重复结算。
  for (const list of [reg.beforeHooks, reg.afterHooks]) {
    for (const [atomType, arr] of list) {
      const filtered = arr.filter((e) => !(e.skillId === skillId && e.ownerId === ownerId));
      if (filtered.length === 0) list.delete(atomType);
      else if (filtered.length !== arr.length) list.set(atomType, filtered);
    }
  }
}

export function getBeforeHooks(state: GameState, atomType: string): AtomHookEntry[] {
  return getRegistry(state).beforeHooks.get(atomType) ?? [];
}

export function getAfterHooks(state: GameState, atomType: string): AtomHookEntry[] {
  return getRegistry(state).afterHooks.get(atomType) ?? [];
}

// ─── 顶层注册 helper(skill 在 onInit 内直接调用) ─────────────

/**
 * 注册一个 action(主动出牌/使用技能/回应/开始等)。
 * 内部封装 registerActionEntry;返回 unloader。
 */
export function registerAction(
  state: GameState,
  skillId: string,
  ownerId: number,
  actionType: string,
  validate: (state: GameState, params: Record<string, Json>) => string | null,
  execute: (state: GameState, params: Record<string, Json>) => Promise<void>,
  rollback?: (state: GameState, params: Record<string, Json>) => void,
): () => void {
  const entry: ActionEntry = { skillId, ownerId, actionType, validate, execute, rollback };
  registerActionEntry(state, entry);
  return () => unregisterActionEntry(state, skillId, ownerId, actionType);
}

/**
 * 注册一个 before atom 钩子。ownerId 在注册时绑定,handler 通过 ctx.ownerId 拿(无需闭包)。
 * before 钩子可返回 HookResult(pass/modify/cancel),after 钩子返回 void。
 */
export function registerBeforeHook(
  state: GameState,
  skillId: string,
  ownerId: number,
  atomType: string,
  handler: (ctx: AtomBeforeContext) => Promise<HookResult | void>,
): () => void {
  const entry: AtomHookEntry = { skillId, ownerId, atomType, phase: 'before', handler };
  const reg = getRegistry(state);
  const list = reg.beforeHooks.get(atomType) ?? [];
  list.push(entry);
  reg.beforeHooks.set(atomType, list);
  return () => {
    const arr = reg.beforeHooks.get(atomType);
    if (!arr) return;
    const idx = arr.indexOf(entry);
    if (idx >= 0) arr.splice(idx, 1);
  };
}

/**
 * 注册一个 after atom 钩子。ownerId 在注册时绑定。
 */
export function registerAfterHook(
  state: GameState,
  skillId: string,
  ownerId: number,
  atomType: string,
  handler: (ctx: AtomAfterContext) => Promise<void>,
): () => void {
  const entry: AtomHookEntry = { skillId, ownerId, atomType, phase: 'after', handler };
  const reg = getRegistry(state);
  const list = reg.afterHooks.get(atomType) ?? [];
  list.push(entry);
  reg.afterHooks.set(atomType, list);
  return () => {
    const arr = reg.afterHooks.get(atomType);
    if (!arr) return;
    const idx = arr.indexOf(entry);
    if (idx >= 0) arr.splice(idx, 1);
  };
}

// ─── 实例管理(state-bound) ──────────────────────────────────

export function setSkillInstanceUnload(state: GameState, skillId: string, ownerId: number, unload: () => void): void {
  getRegistry(state).instanceUnloads.set(instanceKey(skillId, ownerId), unload);
}

export function unloadSkillInstance(state: GameState, skillId: string, ownerId: number): void {
  const reg = getRegistry(state);
  const key = instanceKey(skillId, ownerId);
  const unload = reg.instanceUnloads.get(key);
  if (unload) {
    unload();
    reg.instanceUnloads.delete(key);
  }
  unregisterActionsForInstance(state, skillId, ownerId);
}

export function registerSkillsFromState(state: GameState): Promise<void> {
  const tasks: Promise<Skill | null>[] = [];
  for (const player of state.players) {
    for (const skillId of player.skills) {
      tasks.push(instantiateSkill(state, skillId, player.index));
    }
  }
  return Promise.all(tasks).then(() => undefined);
}

/**
 * 实例化单个 skill(从 create-engine bootstrap / registerSkillsFromState / 添加技能 atom 调用)。
 *
 * 幂等:若 (skillId, ownerId) 已有实例,先卸载旧实例(调其 unload 函数 + 清 action/hook 注册),
 * 再重新注册。保证 registerSkillsFromState 重入、并发 dispatch、动态 添加技能 等场景不会因
 * `registerActionEntry` 的 "already registered" 抛错。
 */
export async function instantiateSkill(state: GameState, skillId: string, ownerId: number): Promise<Skill | null> {
  // 先卸载已有实例(若存在),释放其 action/hook 注册,避免重复注册抛错
  unloadSkillInstance(state, skillId, ownerId);
  // 同步检查:技能模块未注册(如候选人 skills 中的描述性名称)则跳过,不中断开局流程。
  // 用 checker 而非 try-catch 控制流——不确定性不应被 catch 遮蔽。
  if (skillModuleChecker && !skillModuleChecker(skillId)) return null;
  const module = await getSkillModule(skillId);
  const skill = module.createSkill(skillId, ownerId);
  if (module.onInit) {
    const unload = module.onInit(skill, state);
    setSkillInstanceUnload(state, skillId, ownerId, typeof unload === 'function' ? unload : () => {});
  }
  return skill;
}
