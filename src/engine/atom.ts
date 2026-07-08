// src/engine/atom.ts
// atom 注册表 + 基础 apply 引擎(同步,无 awaits)
// 完整 apply pipeline(含 before/after 钩子 + awaits 等待)由 create-engine.ts 接管

import type { Atom, AtomDefinition, GameState, ViewEvent, ViewEventSplit } from './types';

const registry = new Map<string, AtomDefinition>();

export function registerAtom<A>(def: AtomDefinition<A>): void {
  if (registry.has(def.type)) {
    throw new Error(`Atom "${def.type}" already registered`);
  }
  registry.set(def.type, def as unknown as AtomDefinition);
}

export function getAtomDef(type: string): AtomDefinition {
  const def = registry.get(type);
  if (!def) throw new Error(`Atom "${type}" not registered`);
  return def;
}

export function applyAtom(state: GameState, atom: Atom): void {
  getAtomDef(atom.type).apply(state, atom);
}

/**
 * 解析 atom 的前端视图事件。
 * 优先使用 AtomDefinition.toViewEvents；未实现则 fallback 为带 effect 的原始 atom。
 * 当 ViewEvent.type 与 atom.type 不同时，自动设置 atomType 供前端查找 applyView。
 */
export function resolveViewEvents(state: GameState, atom: Atom): ViewEventSplit | undefined {
  const def = getAtomDef(atom.type);
  const explicit = def.toViewEvents?.(state, atom);

  /** ViewEvent.type != atom.type 时补 atomType */
  const ensureAtomType = (event: ViewEvent): ViewEvent =>
    event.type === atom.type ? event : { ...event, atomType: atom.type };

  if (explicit) {
    const ownerViews = new Map<number, ViewEvent | null>();
    for (const [player, evt] of explicit.ownerViews) {
      ownerViews.set(player, evt ? ensureAtomType(evt) : null);
    }
    return {
      ownerViews,
      othersView: explicit.othersView ? ensureAtomType(explicit.othersView) : null,
    };
  }

  // Fallback：构造原始 atom 作为视图事件，所有人看到相同内容。
  // effect 不下发,前端通过 AtomDefinition.effect 静态查表获取。
  const viewEvent = { ...atom } as ViewEvent;
  return {
    ownerViews: new Map(),
    othersView: viewEvent,
  };
}
