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
  if (!self?.alive) return '你已死亡';
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

// ─── 实例级注册表(action + hook) ──────────────────────────────

const actions = new Map<string, ActionEntry>();
const beforeHooks = new Map<string, AtomHookEntry[]>();
const afterHooks = new Map<string, AtomHookEntry[]>();

function actionKey(skillId: string, ownerId: number, actionType: string): string {
  return `${skillId}:${ownerId}:${actionType}`;
}

export function registerActionEntry(entry: ActionEntry): void {
  const k = actionKey(entry.skillId, entry.ownerId, entry.actionType);
  // 先删后加:全局注册表跨房间共享,同一 key 可能被前一个房间占用
  actions.delete(k);
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
  void state; // 保留参数 for API 稳定性(卸载逻辑由 onInit 返回的闭包处理)
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
  if (module.onInit && state) {
    const unload = module.onInit(skill, state);
    setSkillInstanceUnload(skillId, ownerId, typeof unload === 'function' ? unload : () => {});
  }
  return skill;
}
