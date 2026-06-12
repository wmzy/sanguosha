// src/engine/skill.ts
// 技能模块注册 + action/hook 实例注册 + 实例管理
import type {
  ActionEntry,
  AtomHookEntry,
  BackendAPI,
  FrontendAPI,
  GameState,
  Skill,
} from './types';

export interface SkillModule {
  createSkill: (id: string, ownerId: string) => Skill;
  onInit?: (skill: Skill, api: BackendAPI) => (() => void) | void;
  onMount?: (skill: Skill, api: FrontendAPI) => (() => void) | void;
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

export function unregisterActionEntry(skillId: string, ownerId: string, actionType: string): void {
  actions.delete(actionKey(skillId, ownerId, actionType));
}

function unregisterActionsForInstance(skillId: string, ownerId: string): void {
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
  instanceUnloads.set(instanceKey(skillId, ownerId), unload);
}

export function unloadSkillInstance(skillId: string, ownerId: string): void {
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
  };
}

// ─── bootstrap / rebootstrap ────────────────────────────────

/** 遍历 state.players,给每个 skill 调 onInit 注册实例(并保存 unload) */
export function rebootstrap(state: GameState): void {
  for (const player of state.players) {
    for (const skillId of player.skills) {
      instantiateSkill(skillId, player.name);
    }
  }
}

/** 内部 helper:实例化单个 skill(从 create-engine bootstrap / rebootstrap 提取) */
function instantiateSkill(skillId: string, ownerId: string): Skill {
  const module = getSkillModule(skillId);
  const skill = module.createSkill(skillId, ownerId);
  if (module.onInit) {
    const api = makeBackendAPI(skill);
    const unload = module.onInit(skill, api);
    setSkillInstanceUnload(skillId, ownerId, typeof unload === 'function' ? unload : () => {});
  }
  return skill;
}
