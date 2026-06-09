// engine/atom.ts — Atom 注册表 + 统一 applyAtoms 入口 + 钩子集成
//
// 唯一修改 GameState 的通道。`applyAtoms` 是**所有** atom 序列应用的
// 单入口（Phase 10a）：handler 层和技能层（phases/atoms）都走这个函数。
//
// atom-as-event：serverLog 存 AtomLogEntry（resolved atom + id/timestamp），
// 不再经过 ServerEvent 中间层。重放直接循环 applyAtom。

import type {
  GameState,
  Atom,
  AtomDefinition,
  AtomLogEntry,
  AtomPlayerViews,
} from './types';
import { HookRegistry, registerAtomHook, clearAtomHooks, getAtomHooks, filterHooksByPlayer } from './skill-hook';
import { makeLogEntry } from './event';

const registry = new Map<string, AtomDefinition>();

export function clearAtomRegistry(): void {
  registry.clear();
}
// 重新导出：atom 定义文件和测试从 @engine/atom 单入口引入
export { registerAtomHook, clearAtomHooks };

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
  /**
   * 实例级钩子注册表。传入时使用此实例替代全局 hookRegistry。
   * createEngine() 闭包内传入，实现多游戏实例隔离。
   */
  hooks?: HookRegistry;
}

export interface ApplyAtomsResult {
  state: GameState;
  logEntries: AtomLogEntry[];
  playerViews: Map<string, Atom[]>;
}

/** 防止 onAfter.additionalAtoms 递归钩子无限循环 */
const MAX_HOOK_RECURSION = 16;

/**
 * 统一入口：应用 atom 序列，写 serverLog（AtomLogEntry）/ 派 playerViews（如未跳过）。
 *
 * 这是**所有** atom 应用的唯一通道。`phases/atoms`（技能内部）通过
 * `opts.skipPlayerEvents: true` 复用同一路径，serverLog 仍正常写入。
 *
 * 钩子（在 skipHooks=false 时）：
 * - onBefore：可取消/替换 atom、改 state
 * - onAfter：可追加 atom 序列（additionalAtoms 递归应用）、改 state
 */
/**
 * 当前正在 dispatch 的 engine instance 闭包 hookRegistry。
 * 由 `createEngine().dispatch()` 入口设置，退出时清空。
 * 值为 `null` 表示无活跃 engine（fallback 到全局 defaultRegistry）。
 */
let currentEngineHooks: HookRegistry | null = null;

/**
 * 由 createEngine() 在 dispatch 入口调用，注入闭包 hooks。
 * @internal
 */
export function _setCurrentEngineHooks(hooks: HookRegistry | null): void {
  currentEngineHooks = hooks;
}

/**
 * 获取 atom 的 per-player 可见性分叉。
 * 无 toPlayerViews 或返回 undefined → 无分叉（所有人看到同一个 atom）。
 */
function resolvePlayerViews(state: GameState, atom: Atom): AtomPlayerViews | undefined {
  return getAtomDef(atom.type).toPlayerViews?.(state, atom);
}

export function applyAtoms(
  state: GameState,
  atoms: Atom[],
  opts: ApplyAtomsOptions = {},
  _recursionDepth = 0,
): ApplyAtomsResult {
  const hookReg = opts.hooks ?? currentEngineHooks;

  function resolveHooks(atomType: string) {
    if (hookReg) return hookReg.filterByPlayer(hookReg.getByAtomType(atomType), s.currentPlayer);
    return filterHooksByPlayer(getAtomHooks(atomType), s.currentPlayer);
  }

  if (atoms.length === 0) {
    return { state, logEntries: [], playerViews: new Map() };
  }
  if (_recursionDepth > MAX_HOOK_RECURSION) {
    throw new Error('applyAtoms: hook recursion depth exceeded');
  }

  const playerViews = new Map<string, Atom[]>();
  for (const player of state.playerOrder) {
    playerViews.set(player, []);
  }

  let s = state;
  const logEntries: AtomLogEntry[] = [];
  let aborted = false;

  for (const rawAtom of atoms) {
    if (aborted) break;
    let atom = rawAtom;

    // ── onBefore 钩子：可取消/替换/改 state ──
    if (!opts.skipHooks) {
      const playerHooks = resolveHooks(atom.type);
      const self = s.currentPlayer;
      for (const hook of playerHooks) {
        if (hook.filter && !hook.filter(s, atom, self)) continue;
        const result = hook.onBefore?.({ state: s, atom, self });
        if (!result) continue;
        if (result.cancel) {
          atom = null as unknown as Atom;
          break;
        }
        if (result.atom) atom = result.atom;
        if (result.state) s = result.state;
        if (result.redirect && (atom.type === '造成伤害' || atom.type === '成为目标')) {
          atom = { ...atom, target: result.redirect };
        }
      }
    }

    if (atom === (null as unknown as Atom)) continue;

    // ── 生成 AtomLogEntry 写入 serverLog ──
    const logEntry = makeLogEntry(atom);
    logEntries.push(logEntry);

    if (!opts.skipPlayerEvents) {
      const views = resolvePlayerViews(s, atom);
      const updatedPlayerLogs = { ...s.playerLogs };
      for (const player of s.playerOrder) {
        let playerAtom: Atom | null;
        if (views) {
          const [ownerViews, defaultView] = views;
          playerAtom = ownerViews.get(player) ?? defaultView;
        } else {
          // 无分叉：所有人看到同一个 atom
          playerAtom = atom;
        }
        if (playerAtom) {
          playerViews.get(player)!.push(playerAtom);
          updatedPlayerLogs[player] = [...(updatedPlayerLogs[player] ?? []), logEntry.id];
        }
      }
      s = {
        ...s,
        serverLog: [...s.serverLog, logEntry],
        playerLogs: updatedPlayerLogs,
      };
    } else {
      s = {
        ...s,
        serverLog: [...s.serverLog, logEntry],
      };
    }

    s = applyAtom(s, atom);

    // ── onAfter 钩子：可追加 atom 序列/改 state ──
    if (!opts.skipHooks) {
      const playerHooks = resolveHooks(atom.type);
      const self = s.currentPlayer;
      for (const hook of playerHooks) {
        if (hook.filter && !hook.filter(s, atom, self)) continue;
        const result = hook.onAfter?.({ state: s, atom, self, logEntry });
        if (!result) continue;
        if (result.state) s = result.state;
        if (result.additionalAtoms && result.additionalAtoms.length > 0) {
          const sub = applyAtoms(
            s,
            result.additionalAtoms,
            { skipHooks: true, skipPlayerEvents: opts.skipPlayerEvents, hooks: opts.hooks },
            _recursionDepth + 1,
          );
          s = sub.state;
          logEntries.push(...sub.logEntries);
          if (!opts.skipPlayerEvents) {
            for (const [player, views] of sub.playerViews) {
              const existing = playerViews.get(player);
              if (existing) existing.push(...views);
            }
          }
        }
      }
    }
  }

  return { state: s, logEntries, playerViews };
}
