// engine/atom.ts — Atom 注册表 + 统一 applyAtoms 入口 + 钩子集成
//
// 唯一修改 GameState 的通道。`applyAtoms` 是**所有** atom 序列应用的
// 单入口（Phase 10a）：handler 层和技能层（phases/atoms）都走这个函数。
// serverLog 写入、playerEvents 派生、playerLogs 增长 全部由 `applyAtoms`
// 内部完成，调用方不再手工 `atomToEvents` + `applyAtom`。
//
// 不变量：每个 atom 应用后必产生 1 个 server event 进 state.serverLog。
//
// Phase 10b：在 applyAtoms 内部集成 onBefore/onAfter 钩子（engine/skill-hook）。
// - onBefore 支持 cancel（跳过 atom）/ replace（用新 atom 替代）/ modifyState
// - onAfter 支持 additionalAtoms（递归 applyAtoms）/ modifyState
//
// 设计依据：docs/decisions/0012-unified-apply-atoms.md
//           docs/decisions/0013-phase-begin-end-atoms.md

import type {
  GameState,
  Atom,
  AtomDefinition,
  AtomEventResult,
  PlayerEvent,
  ServerEvent,
} from './types';
import { getAtomHooks, filterHooksByPlayer } from './skill-hook';

const registry = new Map<string, AtomDefinition>();

export function registerAtom<A>(def: AtomDefinition<A>): void {
  if (registry.has(def.type)) {
    throw new Error(`Atom type "${def.type}" already registered`);
  }
  registry.set(def.type, def);
}

export function getAtomDef(type: string): AtomDefinition {
  const def = registry.get(type);
  if (!def) throw new Error(`Unknown atom type: "${type}"`);
  return def;
}

export function applyAtom(state: GameState, atom: Atom): GameState {
  return getAtomDef(atom.type).apply(state, atom);
}

export function atomToEvents(state: GameState, atom: Atom): AtomEventResult {
  return getAtomDef(atom.type).toEvents(state, atom);
}

export interface ApplyAtomsOptions {
  /**
   * 跳过派发 playerEvents 与 playerLogs 写入。
   * 技能层（phases/atoms）使用：技能触发的 atom 不应全员广播 per-player 视角。
   * serverLog 仍正常写入。
   */
  skipPlayerEvents?: boolean;
  /**
   * 跳过 onBefore/onAfter 钩子。技能层递归（additionalAtoms）使用，
   * 避免钩子无限递归。
   */
  skipHooks?: boolean;
}

export interface ApplyAtomsResult {
  state: GameState;
  events: ServerEvent[];
  playerEvents: Map<string, PlayerEvent[]>;
}

/** 防止 onAfter.additionalAtoms 递归钩子无限循环 */
const MAX_HOOK_RECURSION = 16;

/**
 * 统一入口：应用 atom 序列，写 serverLog / 派 playerEvents（如未跳过）。
 *
 * 这是**所有** atom 应用的唯一通道。`phases/atoms`（技能内部）通过
 * `opts.skipPlayerEvents: true` 复用同一路径，serverLog 仍正常写入。
 *
 * 钩子（在 skipHooks=false 时）：
 * - onBefore：可取消/替换 atom、改 state
 * - onAfter：可追加 atom 序列（additionalAtoms 递归应用）、改 state
 */
export function applyAtoms(
  state: GameState,
  atoms: Atom[],
  opts: ApplyAtomsOptions = {},
  _recursionDepth = 0,
): ApplyAtomsResult {
  if (atoms.length === 0) {
    return { state, events: [], playerEvents: new Map() };
  }
  if (_recursionDepth > MAX_HOOK_RECURSION) {
    throw new Error('applyAtoms: hook recursion depth exceeded');
  }

  const playerEvents = new Map<string, PlayerEvent[]>();
  for (const player of state.playerOrder) {
    playerEvents.set(player, []);
  }

  let s = state;
  const events: ServerEvent[] = [];

  for (let rawAtom of atoms) {
    let atom = rawAtom;

    // ── onBefore 钩子：可取消/替换/改 state ──
    if (!opts.skipHooks) {
      const hooks = getAtomHooks(atom.type);
      const self = s.currentPlayer;
      const playerHooks = filterHooksByPlayer(hooks, self);
      for (const hook of playerHooks) {
        if (hook.filter && !hook.filter(s, atom, self)) continue;
        const result = hook.onBefore?.({ state: s, atom, self });
        if (!result) continue;
        if (result.cancel) {
          // 跳过该 atom：不派 server event、不 apply、playerEvents 也不动
          atom = null as unknown as Atom;
          break;
        }
        if (result.atom) atom = result.atom;
        if (result.state) s = result.state;
      }
    }

    if (atom === (null as unknown as Atom)) continue;

    const [serverEvent, playerMap, defaultEvent] = atomToEvents(s, atom);
    events.push(serverEvent);

    if (!opts.skipPlayerEvents) {
      const updatedPlayerLogs = { ...s.playerLogs };
      for (const player of s.playerOrder) {
        const specific = playerMap.get(player);
        const evt = specific ?? defaultEvent;
        if (evt) {
          playerEvents.get(player)!.push(evt);
          updatedPlayerLogs[player] = [...(updatedPlayerLogs[player] ?? []), evt.id];
        }
      }
      s = {
        ...s,
        serverLog: [...s.serverLog, serverEvent],
        playerLogs: updatedPlayerLogs,
      };
    } else {
      s = {
        ...s,
        serverLog: [...s.serverLog, serverEvent],
      };
    }

    s = applyAtom(s, atom);

    // ── onAfter 钩子：可追加 atom 序列/改 state ──
    if (!opts.skipHooks) {
      const hooks = getAtomHooks(atom.type);
      const self = s.currentPlayer;
      const playerHooks = filterHooksByPlayer(hooks, self);
      for (const hook of playerHooks) {
        if (hook.filter && !hook.filter(s, atom, self)) continue;
        const result = hook.onAfter?.({ state: s, atom, self, serverEvent });
        if (!result) continue;
        if (result.state) s = result.state;
        if (result.additionalAtoms && result.additionalAtoms.length > 0) {
          // 递归应用 additionalAtoms（不再次触发 onAfter，避免无限递归）
          const sub = applyAtoms(
            s,
            result.additionalAtoms,
            { skipHooks: true, skipPlayerEvents: opts.skipPlayerEvents },
            _recursionDepth + 1,
          );
          s = sub.state;
          events.push(...sub.events);
          if (!opts.skipPlayerEvents) {
            // 合并 playerEvents
            for (const [player, evts] of sub.playerEvents) {
              const existing = playerEvents.get(player);
              if (existing) existing.push(...evts);
            }
          }
        }
      }
    }
  }

  return { state: s, events, playerEvents };
}
