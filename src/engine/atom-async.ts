// engine/atom-async.ts — 异步 applyAtoms（ADR 0025 第 2-3 周产物）
//
// 这是 applyAtoms 的 async 版本：钩子 onBefore / onAfter 改 async，可 await
// pending(...) 挂起等玩家响应。引擎调度器在挂起时冻结 dispatch。
//
// 关键设计点：
// 1. **逐 atom 调度**：每个 atom 跑完整的 onBefore → apply → onAfter 三段。
//    钩子链中任意一个返回 { kind: 'cancel' } 短路该 atom（不 apply / 不写 serverLog）。
// 2. **pending 挂起**：onBefore 或 onAfter 内 await pending(...) 时，pending 抛
//    PendingRequestSignal，applyAtoms 捕获后返回 { state, pending, hookId, ... }。
//    dispatch 不进入下个 action；玩家响应后 dispatch 重新进入本 atom 的钩子链。
// 3. **钩子内 state 重新取**：await 之间 state 可能变化（其他钩子修改）。
//    pending 解决后，下一行代码读 state.localVars 拿新值。
// 4. **additionalAtoms 不重入钩子**：与同步版一致，跳过钩子递归（MAX_HOOK_RECURSION 保护）。
// 5. **序列化恢复**：dispatch 看到 state.pending.type === '异步钩子挂起' 时，读取
//    hookId + atomSnapshot 重新执行钩子，直到下一个 pending。

import type {
  GameState,
  Atom,
  AtomEventResult,
  PlayerEvent,
  ServerEvent,
} from './types';
import type {
  AsyncHook,
  AsyncHookRegistry,
  AsyncPending,
  HookCtx,
  HookResult,
  PendingDef,
  ResumeData,
  SerializedPending,
} from './async-hook';
import { AsyncHookRegistry } from './async-hook';
import {
  PendingRequestSignal,
  setCurrentHookContext,
  AsyncHookContext,
} from './hook-helpers';
import { applyAtom, atomToEvents, getAtomDef } from './atom';

const MAX_HOOK_RECURSION = 16;

export interface ApplyAtomsAsyncOptions {
  skipPlayerEvents?: boolean;
  skipHooks?: boolean;
  /** 实例级异步钩子注册表（createEngine 闭包用） */
  asyncHooks?: AsyncHookRegistry;
}

export interface ApplyAtomsAsyncResult {
  state: GameState;
  events: ServerEvent[];
  playerEvents: Map<string, PlayerEvent[]>;
  /** 钩子挂起时填充。dispatch 收到非 null pending 时不进入下个 action */
  pending: AsyncPending | null;
}

export interface ApplyAtomsResume {
  /** 玩家响应（来自 dispatch 解析） */
  resume: ResumeData;
}

export async function applyAtomsAsync(
  state: GameState,
  atoms: Atom[],
  opts: ApplyAtomsAsyncOptions = {},
  _recursionDepth = 0,
  _resume?: ApplyAtomsResume,
): Promise<ApplyAtomsAsyncResult> {
  if (_recursionDepth > MAX_HOOK_RECURSION) {
    throw new Error('applyAtomsAsync: hook recursion depth exceeded');
  }

  const hookReg = opts.asyncHooks;
  const playerEvents = new Map<string, PlayerEvent[]>();
  for (const player of state.playerOrder) {
    playerEvents.set(player, []);
  }

  let s = state;
  const events: ServerEvent[] = [];

  for (const rawAtom of atoms) {
    let atom = rawAtom;

    // ── onBefore 钩子链 ──
    if (!opts.skipHooks && hookReg) {
      const hooks = filterAsyncHooks(hookReg, atom.type, s.currentPlayer, s, atom);
      for (const hook of hooks) {
        const result = await runHookOnBefore(hook, { state: s, atom, self: s.currentPlayer, resume: _resume?.resume });
        if (result.kind === 'cancel') {
          // 整个链断：跳过该 atom
          atom = null as unknown as Atom;
          break;
        }
        if (result.kind === 'redirect' && (atom.type === '造成伤害' || atom.type === '成为目标')) {
          atom = { ...atom, target: result.target };
        }
        if (result.kind === 'modifyState') s = result.state;
        if (result.kind === 'pending') {
          return {
            state: s,
            events,
            playerEvents,
            pending: buildAsyncPending(result.def, hook.id, 'onBefore', atom, s.currentPlayer, result.tag),
          };
        }
        if (result.kind === 'pendingThen') {
          // pendingThen：先挂 pending，玩家响应后调 then
          return {
            state: s,
            events,
            playerEvents,
            pending: buildAsyncPending(result.def, hook.id, 'onResume', atom, s.currentPlayer, result.tag, result.then),
          };
        }
      }
    }

    if (atom === (null as unknown as Atom)) continue;

    // ── apply atom ──
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
      s = { ...s, serverLog: [...s.serverLog, serverEvent], playerLogs: updatedPlayerLogs };
    } else {
      s = { ...s, serverLog: [...s.serverLog, serverEvent] };
    }

    s = applyAtom(s, atom);

    // ── onAfter 钩子链 ──
    if (!opts.skipHooks && hookReg) {
      const hooks = filterAsyncHooks(hookReg, atom.type, s.currentPlayer, s, atom);
      for (const hook of hooks) {
        const result = await runHookOnAfter(hook, { state: s, atom, self: s.currentPlayer, serverEvent, resume: _resume?.resume });
        if (result.kind === 'modifyState') s = result.state;
        if (result.kind === 'additionalAtoms' && result.atoms.length > 0) {
          // 递归应用 additionalAtoms（不触发钩子，避免无限递归）
          const sub = await applyAtomsAsync(
            s, result.atoms,
            { skipHooks: true, skipPlayerEvents: opts.skipPlayerEvents, asyncHooks: opts.asyncHooks },
            _recursionDepth + 1,
          );
          s = sub.state;
          events.push(...sub.events);
          if (sub.pending) {
            return { state: s, events, playerEvents, pending: sub.pending };
          }
          if (!opts.skipPlayerEvents) {
            for (const [player, evts] of sub.playerEvents) {
              const existing = playerEvents.get(player);
              if (existing) existing.push(...evts);
            }
          }
        }
        if (result.kind === 'pending') {
          return {
            state: s,
            events,
            playerEvents,
            pending: buildAsyncPending(result.def, hook.id, 'onAfter', atom, s.currentPlayer, result.tag),
          };
        }
        if (result.kind === 'pendingThen') {
          return {
            state: s,
            events,
            playerEvents,
            pending: buildAsyncPending(result.def, hook.id, 'onResume', atom, s.currentPlayer, result.tag, result.then),
          };
        }
      }
    }
  }

  return { state: s, events, playerEvents, pending: null };
}

// ════════════════════════════════════════════════════════════════════
// 钩子辅助
// ════════════════════════════════════════════════════════════════════

function filterAsyncHooks(
  reg: AsyncHookRegistry,
  atomType: string,
  player: string,
  state: GameState,
  atom: Atom,
): AsyncHook[] {
  return reg.getByAtomType(atomType, player).filter((h) => {
    if (h.filter && !h.filter(state, atom, player)) return false;
    return true;
  });
}

async function runHookOnBefore(
  hook: AsyncHook,
  ctx: HookCtx,
): Promise<HookResult> {
  if (!hook.onBefore) return { kind: 'continue' };
  setCurrentHookContext({ state: ctx.state, atom: ctx.atom, self: ctx.self, hookId: hook.id, awaiting: false });
  try {
    const result = await hook.onBefore(ctx);
    return result ?? { kind: 'continue' };
  } catch (err) {
    if (err instanceof PendingRequestSignal) {
      return { kind: 'pending', def: err.def, tag: err.tag };
    }
    throw err;
  } finally {
    setCurrentHookContext(null);
  }
}

async function runHookOnAfter(
  hook: AsyncHook,
  ctx: HookCtx,
): Promise<HookResult> {
  if (!hook.onAfter) return { kind: 'continue' };
  setCurrentHookContext({ state: ctx.state, atom: ctx.atom, self: ctx.self, hookId: hook.id, serverEvent: ctx.serverEvent, awaiting: false });
  try {
    const result = await hook.onAfter(ctx);
    return result ?? { kind: 'continue' };
  } catch (err) {
    if (err instanceof PendingRequestSignal) {
      return { kind: 'pending', def: err.def, tag: err.tag };
    }
    throw err;
  } finally {
    setCurrentHookContext(null);
  }
}

function buildAsyncPending(
  def: PendingDef,
  hookId: string,
  resumePoint: 'onBefore' | 'onAfter' | 'onResume',
  atom: Atom,
  self: string,
  tag?: Json,
  onResumeFn?: (ctx: HookCtx) => Promise<HookResult | HookResult[]>,
): AsyncPending {
  const startedAt = Date.now();
  const deadline = def.timeout ? startedAt + def.timeout : 0;
  return {
    type: '异步钩子挂起',
    id: `${hookId}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    hookId,
    resumePoint,
    atomSnapshot: atom,
    self,
    def,
    startedAt,
    deadline,
    tag,
    onResumeFn,
  };
}

import type { Json } from './types';
