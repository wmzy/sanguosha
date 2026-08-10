// src/engine/core/atom.ts
// atom 定义查表:getAtomDef / applyAtom / resolveViewEvents。
// atom 定义静态聚合于 atoms/index.ts 的 atomMap(Record<AtomName, AtomDefinition>
// 编译期完整性保证)——新增 atom 必须同时加 Atom 联合成员和 atomMap 条目,否则 tsc 报错,
// 消灭"atom 未注册"运行时错误。展示型 ViewEvent.type(非 Atom.type)由展示型atoms fallback。
// 完整 apply pipeline(before/after 钩子 + awaits 等待)由 core/apply.ts 接管。

import type { Atom, AtomDefinition, GameState, ViewEvent, ViewEventSplit } from '../types';
import { atomMap, 展示型atoms } from '../atoms';

/** 按 type 查 atom 定义。优先 atomMap(引擎 Atom),fallback 展示型atoms(ViewEvent-only type)。 */
export function getAtomDef(type: string): AtomDefinition {
  // atomMap 声明为 Record<AtomName,…>(编译期保证 AtomName 全覆盖);
  // 此处用 string 索引以允许运行时查 ViewEvent.type,未命中走 fallback。
  const lookup = atomMap as Record<string, AtomDefinition>;
  return lookup[type] ?? 展示型atoms[type] ?? throwMissing(type);
}

function throwMissing(type: string): never {
  throw new Error(`Atom "${type}" not found`);
}

/** 同步应用一个 atom 的 apply(不走 hook pipeline)。完整管线见 core/apply.ts:applyAtom。 */
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
