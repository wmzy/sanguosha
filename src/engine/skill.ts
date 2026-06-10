// src/engine/skill.ts
// 技能模块注册 + action/hook 实例注册 + 实例管理
import type {
  ActionEntry,
  AtomHookEntry,
  BackendAPI,
  FrontendAPI,
  Json,
  SettlementFrame,
  Skill,
} from './types';

export interface SkillModule {
  createSkill(id: string, ownerId: string): Skill;
  onInit?(skill: Skill, api: BackendAPI): () => void;
  onMount?(skill: Skill, api: FrontendAPI): () => void;
}

// ─── module 注册表 ───────────────────────────────────────────

const modules = new Map<string, SkillModule>();

export function registerSkillModule(id: string, m: SkillModule): void {
  modules.set(id, m);
}

export function getSkillModule(id: string): SkillModule {
  const m = modules.get(id);
  if (!m) throw new Error(`Skill module "${id}" not registered`);
  return m;
}

export function clearSkillModules(): void {
  modules.clear();
}

// ─── 实例级注册表(action + hook) ──────────────────────────────

const actions = new Map<string, ActionEntry>();
const beforeHooks = new Map<string, AtomHookEntry[]>();
const afterHooks = new Map<string, AtomHookEntry[]>();

function actionKey(skillId: string, ownerId: string, actionType: string): string {
  return `${skillId}:${ownerId}:${actionType}`;
}

export function registerActionEntry(entry: ActionEntry): void {
  const k = actionKey(entry.skillId, entry.ownerId, entry.actionType);
  if (actions.has(k)) throw new Error(`Action "${k}" already registered`);
  actions.set(k, entry);
}

export function findActionEntry(skillId: string, ownerId: string, actionType: string): ActionEntry | undefined {
  return actions.get(actionKey(skillId, ownerId, actionType));
}

function unregisterActionsForInstance(skillId: string, ownerId: string): void {
  const prefix = `${skillId}:${ownerId}:`;
  for (const k of Array.from(actions.keys())) {
    if (k.startsWith(prefix)) actions.delete(k);
  }
  for (const map of [beforeHooks, afterHooks]) {
    for (const [k, list] of Array.from(map.entries())) {
      const filtered = list.filter(h => !(h.skillId === skillId && h.ownerId === ownerId));
      if (filtered.length === 0) {
        map.delete(k);
      } else {
        map.set(k, filtered);
      }
    }
  }
}

export function getBeforeHooks(atomType: string): AtomHookEntry[] {
  return beforeHooks.get(atomType) ?? [];
}

export function getAfterHooks(atomType: string): AtomHookEntry[] {
  return afterHooks.get(atomType) ?? [];
}

function registerHook(phase: 'before' | 'after', entry: AtomHookEntry): void {
  const map = phase === 'before' ? beforeHooks : afterHooks;
  const list = map.get(entry.atomType) ?? [];
  list.push(entry);
  map.set(entry.atomType, list);
}

function removeHook(phase: 'before' | 'after', entry: AtomHookEntry): void {
  const map = phase === 'before' ? beforeHooks : afterHooks;
  const list = map.get(entry.atomType);
  if (!list) return;
  const idx = list.indexOf(entry);
  if (idx >= 0) list.splice(idx, 1);
}

// ─── 实例管理 ──────────────────────────────────────────────

const instanceUnloads = new Map<string, () => void>();

function instanceKey(skillId: string, ownerId: string): string {
  return `${skillId}:${ownerId}`;
}

export function setSkillInstanceUnload(skillId: string, ownerId: string, unload: () => void): void {
  const k = instanceKey(skillId, ownerId);
  const prev = instanceUnloads.get(k);
  instanceUnloads.set(k, () => {
    prev?.();
    unload();
  });
}

export function unloadSkillInstance(skillId: string, ownerId: string): void {
  const k = instanceKey(skillId, ownerId);
  const unload = instanceUnloads.get(k);
  if (unload) {
    unload();
    instanceUnloads.delete(k);
  }
  unregisterActionsForInstance(skillId, ownerId);
}

export function clearAllSkillInstances(): void {
  for (const unload of instanceUnloads.values()) unload();
  instanceUnloads.clear();
  actions.clear();
  beforeHooks.clear();
  afterHooks.clear();
}

// ─── 给 skill 的 BackendAPI ────────────────────────────────

export function makeBackendAPI(skill: Skill): BackendAPI {
  return {
    self: skill.ownerId,
    registerAction(actionType, validate, execute) {
      const entry: ActionEntry = { skillId: skill.id, ownerId: skill.ownerId, actionType, validate, execute };
      registerActionEntry(entry);
      return () => {
        const k = actionKey(skill.id, skill.ownerId, actionType);
        actions.delete(k);
      };
    },
    onAtomBefore(atomType, handler) {
      const entry: AtomHookEntry = { skillId: skill.id, ownerId: skill.ownerId, atomType, phase: 'before', handler: handler as AtomHookEntry['handler'] };
      registerHook('before', entry);
      return () => removeHook('before', entry);
    },
    onAtomAfter(atomType, handler) {
      const entry: AtomHookEntry = { skillId: skill.id, ownerId: skill.ownerId, atomType, phase: 'after', handler: handler as AtomHookEntry['handler'] };
      registerHook('after', entry);
      return () => removeHook('after', entry);
    },
    /**
     * onInit 阶段不允许直接 apply(没有 active settlement frame,没有
     * before/after 钩子链,没有 await 暂停)。需要应用 atom 的场景
     * 应该使用钩子上下文(AtomBeforeContext.apply / AtomAfterContext.apply),
     * 它们已经在 settlement.ts:58-60, 108-110 完整实现。
     *
     * 此处保留 apply 接口仅因为 type 定义需要;onInit 内调用会抛错,
     * 引导开发者使用 ctx.apply。
     */
    apply(atom) {
      throw new Error(
        `api.apply 不能在 onInit 阶段调用(atom=${JSON.stringify(atom)}).` +
        `请在 onAtomBefore/onAtomAfter handler 内通过 ctx.apply(atom) 调用.`,
      );
    },
    notify() {
      // 简化:noop(同 apply,onInit 阶段无活跃事件流)
    },
  };
}
