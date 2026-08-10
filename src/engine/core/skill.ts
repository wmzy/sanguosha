// core/skill.ts — action/hook 注册表 CRUD + state-bound 注册表(WeakMap 外挂)。
//
// 纯注册表操作:registerAction / registerBeforeHook / registerAfterHook /
// registerJudgeModifier / declareAlternativeResponse + 对应的查询/清理。
// 模块加载与实例生命周期(instantiateSkill / unloadSkillInstance / moduleCache)
// 已迁至 skills/lifecycle.ts,该处可直接 import skillLoaders 与 cardEffectMap,
// 无需 service locator setter。
//
// 注册表通过 WeakMap 外挂在 GameState 上,实现 state 隔离 = 注册表隔离。
// 这消除了模块级全局状态导致的跨对局泄漏(如 流离 hook 残留错误触发)。

import type {
  ActionEntry,
  AtomAfterContext,
  AtomBeforeContext,
  AtomHookEntry,
  AtomName,
  AtomOfName,
  GameState,
  HookResult,
  Json,
  PendingSlot,
} from '../types';
import { TARGET_SYSTEM } from '../types';
import { isTrickBlocked } from '../rules/trick-quota';

// ─── state-bound 注册表(WeakMap 外挂) ────────────────────────

/** 替代回应能力声明:技能在 onInit 中通过 declareAlternativeResponse 注册,
 *  声明其拥有者能在指定 atom 类型(可选 requestType)下用非字面牌回应。
 *  hasAlternativeResponse 查此表(替代旧的硬编码技能名单)。
 *  与 before-hook 型替代(八卦阵/八阵)互补:hook 型自动检测,声明型用于 action/转化型技能。 */
export interface AltResponseDecl {
  ownerId: number;
  atomType: string;
  /** 仅 '请求回应' 时有意义,如 '桃/求桃'。缺省=匹配该 atomType 的所有 requestType。 */
  requestType?: string;
}

interface SkillRegistry {
  actions: Map<string, ActionEntry>;
  beforeHooks: Map<string, AtomHookEntry[]>;
  afterHooks: Map<string, AtomHookEntry[]>;
  /** 判定改判钩子:key=ownerId(座次),每玩家至多一个改判能力(鬼才/鬼道)。
   *  由 判定 atom 的 afterApply 阶段遍历触发,与普通 after hook 解耦。 */
  judgeModifiers: Map<number, AtomHookEntry>;
  instanceUnloads: Map<string, () => void>;
  /** 技能 isLocked 元数据(实例化时写入):skillId → isLocked。
   *  供 skill-suppression 查询,替代旧 getCachedSkillModule 反射查询。 */
  lockedSkills: Map<string, boolean>;
  /** 替代回应能力声明表(技能就近注册)。 */
  altResponseDecls: AltResponseDecl[];
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
      judgeModifiers: new Map(),
      instanceUnloads: new Map(),
      lockedSkills: new Map(),
      altResponseDecls: [],
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
 *  查找顺序:ownerId 阻塞型精确匹配 → 广播型(target<TARGET_SYSTEM) → 唯一活跃 slot(兜底)。
 *  无匹配返回 undefined。
 *
 *  ownerId 精确匹配仅接受阻塞型 slot:出牌窗口是非阻塞 pending(key=出牌者座次),
 *  若不排除,出牌者 respond 广播型无懈可击时第一步 get(ownerId) 会误命中出牌窗口
 *  而非无懈广播 slot(key=-2),导致无懈 validate 误判「当前不是无懈窗口」→ 出牌者本人
 *  无法 respond 无懈(含反无懈)。无懈是广播型,目标是锦囊牌本身,不应与使用者玩家绑定。 */
export function findPendingSlot(state: GameState, ownerId: number): PendingSlot | undefined {
  // 1. ownerId 精确匹配,仅限阻塞型 slot(排除出牌窗口等非阻塞 pending)。
  const direct = state.pendingSlots.get(ownerId);
  if (direct?.isBlocking) return direct;
  // 2. 广播型 slot(target<TARGET_SYSTEM,如无懈可击):所有玩家共用一个 slot。
  const broadcast = [...state.pendingSlots.values()].find((s) => {
    const t = (s.atom as { target?: unknown }).target;
    return typeof t === 'number' && t < TARGET_SYSTEM;
  });
  if (broadcast) return broadcast;
  // 3. 唯一活跃 slot 兜底:仅当只剩一个且属于请求者(不误匹配其他玩家的出牌窗口等)。
  if (state.pendingSlots.size === 1) {
    const slot = [...state.pendingSlots.values()][0];
    const target =
      (slot.atom as { target?: number }).target ?? (slot.atom as { player?: number }).player;
    return typeof target === 'number' && target === ownerId ? slot : undefined;
  }
  return undefined;
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
  if (opts?.cardName && state.cardMap[cardId]?.name !== opts.cardName)
    return `不是${opts.cardName}`;
  // 普通锦囊牌阻断器(界简雍·巧说没赢后本回合禁用锦囊)。
  // 仅对普通锦囊牌生效(延时锦囊走 乐不思蜀/兵粮寸断 等独立技能,响应锦囊=无懈可击
  // 由 respond 路径出,不走 use)。普通锦囊牌 = type='锦囊牌' 且 trickSubtype !== '延时锦囊'/'响应锦囊'。
  const card = state.cardMap[cardId];
  if (
    card?.type === '锦囊牌' &&
    card.trickSubtype !== '延时锦囊' &&
    card.trickSubtype !== '响应锦囊' &&
    isTrickBlocked(state, ownerId)
  ) {
    return '本回合不能使用锦囊牌';
  }
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

export function findActionEntry(
  state: GameState,
  skillId: string,
  ownerId: number,
  actionType: string,
): ActionEntry | undefined {
  return getRegistry(state).actions.get(actionKey(skillId, ownerId, actionType));
}

export function unregisterActionEntry(
  state: GameState,
  skillId: string,
  ownerId: number,
  actionType: string,
): void {
  getRegistry(state).actions.delete(actionKey(skillId, ownerId, actionType));
}

export function unregisterActionsForInstance(state: GameState, skillId: string, ownerId: number): void {
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
  // 同实例的改判钩子也需清理(按 ownerId 键)
  const jm = reg.judgeModifiers.get(ownerId);
  if (jm?.skillId === skillId) reg.judgeModifiers.delete(ownerId);
}

export function getBeforeHooks(state: GameState, atomType: string): AtomHookEntry[] {
  return getRegistry(state).beforeHooks.get(atomType) ?? [];
}

export function getAfterHooks(state: GameState, atomType: string): AtomHookEntry[] {
  return getRegistry(state).afterHooks.get(atomType) ?? [];
}

/** 取判定改判钩子表(key=ownerId 座次)。由 判定 atom 的 afterApply 阶段遍历调用。 */
export function getJudgeModifierMap(state: GameState): Map<number, AtomHookEntry> {
  return getRegistry(state).judgeModifiers;
}

// ─── 替代回应能力声明(技能 onInit 内就近注册) ───────────────

/**
 * 声明 ownerId 拥有者在指定 atomType(+可选 requestType)下的「替代回应能力」:
 * 能用非字面响应牌的方式回应(如龙胆杀当闪、急救红牌当桃、蛊惑声明当桃)。
 *
 * 卡牌回应预检(card-response-availability)据此决定是否走 normal 询问——
 * 拥有替代能力的 target 即使手牌中无字面匹配牌,也必须正常询问(skip/silent 会错误剥夺技能)。
 *
 * 与 before-hook 型替代(八卦阵/八阵自动检测)互补:本 API 用于 action/转化型技能。
 * 返回 unloader,随技能卸载自动清理(与 registerAction/registerBeforeHook 一致)。
 */
export function declareAlternativeResponse(
  state: GameState,
  ownerId: number,
  atomType: string,
  requestType?: string,
): () => void {
  const decl: AltResponseDecl = { ownerId, atomType, requestType };
  const reg = getRegistry(state);
  reg.altResponseDecls.push(decl);
  return () => {
    const idx = reg.altResponseDecls.indexOf(decl);
    if (idx >= 0) reg.altResponseDecls.splice(idx, 1);
  };
}

/** 查询 target 是否声明了指定 atomType(+可选 requestType)的替代回应能力。 */
export function hasDeclaredAlternativeResponse(
  state: GameState,
  atomType: string,
  target: number,
  requestType?: string,
): boolean {
  const list = getRegistry(state).altResponseDecls;
  for (const d of list) {
    if (d.ownerId !== target) continue;
    if (d.atomType !== atomType) continue;
    if (d.requestType && requestType && d.requestType !== requestType) continue;
    return true;
  }
  return false;
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
  rollback?: (state: GameState, params: Record<string, Json>) => void | Promise<void>,
): () => void {
  const entry: ActionEntry = { skillId, ownerId, actionType, validate, execute, rollback };
  registerActionEntry(state, entry);
  return () => unregisterActionEntry(state, skillId, ownerId, actionType);
}

/**
 * 注册一个 before atom 钩子。ownerId 在注册时绑定,handler 通过 ctx.ownerId 拿(无需闭包)。
 * before 钩子可返回 HookResult(pass/modify/cancel),after 钩子返回 void。
 */
export function registerBeforeHook<T extends AtomName>(
  state: GameState,
  skillId: string,
  ownerId: number,
  atomType: T,
  handler: (ctx: AtomBeforeContext<AtomOfName<T>>) => Promise<HookResult | void>,
): () => void {
  // handler 收窄到 AtomBeforeContext<T>(按 atomType);存储擦除为宽类型——
  // 注册表按 atomType 分发,运行时 ctx.atom 必然匹配 T,擦除安全。
  const entry: AtomHookEntry = {
    skillId, ownerId, atomType, phase: 'before',
    handler: handler as AtomHookEntry['handler'],
  };
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
export function registerAfterHook<T extends AtomName>(
  state: GameState,
  skillId: string,
  ownerId: number,
  atomType: T,
  handler: (ctx: AtomAfterContext<AtomOfName<T>>) => Promise<void>,
): () => void {
  const entry: AtomHookEntry = {
    skillId, ownerId, atomType, phase: 'after',
    handler: handler as AtomHookEntry['handler'],
  };
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

/**
 * 注册判定改判钩子(鬼才/鬼道)。每玩家座次至多一个改判能力(key=ownerId)。
 *
 * 由 判定 atom 的 afterApply 阶段触发——在判定牌翻开(apply 完成)后、
 * 消费方(闪电/兵粮寸断/乐不思蜀/八卦阵…)的 after hook 读取判定牌之前。
 *
 * 与 registerAfterHook('判定', ...) 的关键差异:遍历顺序不依赖注册序,而是
 * 由 runJudgeModifiers 按「从判定目标起逆时针」依次询问存活玩家,
 * 彻底消除旧实现「改判方须座次靠前于消费方才能生效」的缺陷。
 */
export function registerJudgeModifier(
  state: GameState,
  skillId: string,
  ownerId: number,
  // handler 的 ctx.atom 运行时是「判定牌生效前」atom（由 judge-timing.ts 的 afterApply 调
  // runJudgeModifiers 从 atomStack 顶取出），而非注册元数据里的 '判定'。故用默认 Atom 全联合
  // 而非 AtomOfName<'判定'> 窄化——窄化会让 ctx.atom.type 收窄为 '判定'，与 '判定牌生效前'
  // 比较报 TS2367（无重叠）。
  handler: (ctx: AtomAfterContext) => Promise<void>,
): () => void {
    const entry: AtomHookEntry = {
    skillId, ownerId, atomType: '判定', phase: 'after',
    handler,
  };
  const reg = getRegistry(state);
  reg.judgeModifiers.set(ownerId, entry);
  return () => {
    const cur = reg.judgeModifiers.get(ownerId);
    if (cur === entry) reg.judgeModifiers.delete(ownerId);
  };
}

// ─── 实例管理(state-bound) ──────────────────────────────────
// 实例化/卸载生命周期由 skills/lifecycle.ts 管理(那里可直接 import skillLoaders
// 和 cardEffectMap,无需 service locator setter)。本文件只提供注册表读写原语。

export function setSkillInstanceUnload(
  state: GameState,
  skillId: string,
  ownerId: number,
  unload: () => void,
): void {
  getRegistry(state).instanceUnloads.set(instanceKey(skillId, ownerId), unload);
}

export function getSkillInstanceUnload(
  state: GameState,
  skillId: string,
  ownerId: number,
): (() => void) | undefined {
  return getRegistry(state).instanceUnloads.get(instanceKey(skillId, ownerId));
}

export function deleteSkillInstanceUnload(
  state: GameState,
  skillId: string,
  ownerId: number,
): void {
  getRegistry(state).instanceUnloads.delete(instanceKey(skillId, ownerId));
}

/** 写入技能 isLocked 元数据(实例化时由 lifecycle.ts 调用)。 */
export function setSkillLocked(state: GameState, skillId: string, isLocked: boolean): void {
  getRegistry(state).lockedSkills.set(skillId, isLocked);
}

/** 查询技能是否为锁定技(suppression provider 用,锁定技永不压制)。 */
export function isSkillLocked(state: GameState, skillId: string): boolean {
  return getRegistry(state).lockedSkills.get(skillId) ?? false;
}
