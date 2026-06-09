// src/engine/atom.ts
// atom 注册表 + 基础 apply 引擎(同步,无 awaits)
// 完整 apply pipeline(含 before/after 钩子 + awaits 等待)由 settlement.ts 接管

import type { Atom, AtomDefinition, GameState, AtomPlayerViews } from './types';

const registry = new Map<string, AtomDefinition>();

export function registerAtom<A>(def: AtomDefinition<A>): void {
  if (registry.has(def.type)) {
    throw new Error(`Atom "${def.type}" already registered`);
  }
  registry.set(def.type, def);
}

export function clearAtomRegistry(): void {
  registry.clear();
}

export function getAtomDef(type: string): AtomDefinition {
  const def = registry.get(type);
  if (!def) throw new Error(`Atom "${type}" not registered`);
  return def;
}

export function applyAtom(state: GameState, atom: Atom): GameState {
  return getAtomDef(atom.type).apply(state, atom);
}

export function resolvePlayerViews(
  state: GameState,
  atom: Atom,
): AtomPlayerViews | undefined {
  return getAtomDef(atom.type).toPlayerViews?.(state, atom);
}