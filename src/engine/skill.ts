// src/engine/skill.ts
// 技能模块注册 + action/hook 实例注册 + 实例管理
import type { ActionEntry, AtomHookEntry, BackendAPI, FrontendAPI, GameState, Json, SettlementFrame, Skill } from './types';

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

const actions = new Map<string, ActionEntry>();                // key = skillId + ':' + ownerId + ':' + actionType
const beforeHooks = new Map<string, AtomHookEntry[]>();        // key = atomType
const afterHooks = new Map<string, AtomHookEntry[]>();

function actionKey(skillId: string, ownerId: string, actionType: string): string {
  return `${skillId}:${ownerId}:${actionType}`;
}

function hookKey(atomType: string): string {
  return atomType;
}

export function registerActionEntry(entry: ActionEntry): void {
  const k = actionKey(entry.skillId, entry.ownerId, entry.actionType);
  if (actions.has(k)) throw new Error(`Action "${k}" already registered`);
  actions.set(k, entry);
}

export function findActionEntry(skillId: string, ownerId: string, actionType: string): ActionEntry | undefined {
  return actions.get(actionKey(skillId, ownerId, actionType));
}

export function unregisterActionsForInstance(skillId: string, ownerId: string): void {
  for (const k of Array.from(actions.keys())) {
    if (k.startsWith(`${skillId}:${ownerId}:`)) actions.delete(k);
  }
  // 同步清理 hooks
  for (const list of [beforeHooks, afterHooks]) {
    for (const arr of list.values()) {
      const filtered = arr.filter(h => !(h.skillId === skillId && h.ownerId === ownerId));
      if (filtered.length === 0) continue;
      // 注意:不可变替换
      arr.length = 0;
      arr.push(...filtered);
    }
  }
}

export function registerHookEntry(phase: 'before' | 'after', entry: AtomHookEntry): void {
  const map = phase === 'before' ? beforeHooks : afterHooks;
  const k = hookKey(entry.atomType);
  const list = map.get(k) ?? [];
  list.push(entry);
  map.set(k, list);
}

export function getBeforeHooks(atomType: string): AtomHookEntry[] {
  return beforeHooks.get(hookKey(atomType)) ?? [];
}

export function getAfterHooks(atomType: string): AtomHookEntry[] {
  return afterHooks.get(hookKey(atomType)) ?? [];
}

// ─── 实例管理(per player skill) ───────────────────────────────

const instances = new Map<string, () => void>();  // key = skillId + ':' + ownerId, value = 卸载函数

function instanceKey(skillId: string, ownerId: string): string {
  return `${skillId}:${ownerId}`;
}

export function setSkillInstanceUnload(skillId: string, ownerId: string, unload: () => void): void {
  const k = instanceKey(skillId, ownerId);
  // 合并卸载
  const prev = instances.get(k);
  instances.set(k, () => {
    prev?.();
    unload();
  });
}

export function unloadSkillInstance(skillId: string, ownerId: string): void {
  const k = instanceKey(skillId, ownerId);
  const unload = instances.get(k);
  if (unload) {
    unload();
    instances.delete(k);
  }
  unregisterActionsForInstance(skillId, ownerId);
}

export function clearAllSkillInstances(): void {
  for (const unload of instances.values()) unload();
  instances.clear();
  actions.clear();
  beforeHooks.clear();
  afterHooks.clear();
}

// ─── 给 skill 的 BackendAPI(供 skill.onInit 调用) ─────────────

export function makeBackendAPI(skill: Skill): BackendAPI {
  return {
    registerAction(actionType, validate, execute) {
      registerActionEntry({ skillId: skill.id, ownerId: skill.ownerId, actionType, validate, execute });
      return () => {
        const k = actionKey(skill.id, skill.ownerId, actionType);
        actions.delete(k);
      };
    },
    onAtomBefore(atomType, handler) {
      const entry: AtomHookEntry = { skillId: skill.id, ownerId: skill.ownerId, atomType, phase: 'before', handler: handler as AtomHookEntry['handler'] };
      registerHookEntry('before', entry);
      return () => {
        const list = beforeHooks.get(hookKey(atomType)) ?? [];
        const idx = list.indexOf(entry);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    onAtomAfter(atomType, handler) {
      const entry: AtomHookEntry = { skillId: skill.id, ownerId: skill.ownerId, atomType, phase: 'after', handler: handler as AtomHookEntry['handler'] };
      registerHookEntry('after', entry);
      return () => {
        const list = afterHooks.get(hookKey(atomType)) ?? [];
        const idx = list.indexOf(entry);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    apply(atom) {
      // 实际 apply 由 dispatch 流程处理,这里返回 Promise.resolve()
      // 真正接入 settlement pipeline 后,这里会调用 settlement.apply(atom)
      return Promise.resolve();
    },
    notify() {
      // notify 占位
    },
  };
}
