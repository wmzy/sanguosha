// engine/atom-async.ts — 异步 applyAtoms（ADR 0025 第 2-3 周产物）

import type {
  GameState,
  Atom,
  Json,
  AtomLogEntry,
} from './types';
import type {
  AsyncHook,
  AsyncHookRegistry,
  AsyncPending,
  HookCtx,
  HookResult,
  PendingDef,
  ResumeData,
} from './async-hook';
import {
  PendingRequestSignal,
  setCurrentHookContext,
  getCurrentHookContext,
} from './hook-helpers';
import { applyAtom } from './atom';
import { makeLogEntry } from './event';

const MAX_HOOK_RECURSION = 16;

export interface ApplyAtomsAsyncOptions {
  skipPlayerEvents?: boolean;
  skipHooks?: boolean;
  skipApply?: boolean;
  asyncHooks?: AsyncHookRegistry;
}

export interface ApplyAtomsAsyncResult {
  state: GameState;
  logEntries: AtomLogEntry[];
  playerViews: Map<string, Atom[]>;
  pending: AsyncPending | null;
}

export interface ApplyAtomsResume {
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
  const playerViews = new Map<string, Atom[]>();
  for (const player of state.playerOrder) {
    playerViews.set(player, []);
  }

  let s = state;
  const logEntries: AtomLogEntry[] = [];

  for (const rawAtom of atoms) {
    let atom = rawAtom;

    if (!opts.skipHooks && hookReg) {
      const hooks = filterAsyncHooks(hookReg, atom.type, s.currentPlayer, s, atom);
      for (const hook of hooks) {
        const result = await runHookOnBefore(hook, { state: s, atom, self: s.currentPlayer }, _resume?.resume);
        if (result.kind === 'cancel') {
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
            logEntries,
            playerViews,
            pending: buildAsyncPending(result.def, hook.id, 'onBefore', atom, s.currentPlayer, result.tag),
          };
        }
      }
    }

    if (atom === (null as unknown as Atom)) continue;

    let logEntry: AtomLogEntry | undefined;
    if (!opts.skipApply) {
      logEntry = makeLogEntry(atom);
      logEntries.push(logEntry);

      if (!opts.skipPlayerEvents) {
        const updatedPlayerLogs = { ...s.playerLogs };
        for (const player of s.playerOrder) {
          playerViews.get(player)!.push(atom);
          updatedPlayerLogs[player] = [...(updatedPlayerLogs[player] ?? []), logEntry.id];
        }
        s = { ...s, serverLog: [...s.serverLog, logEntry], playerLogs: updatedPlayerLogs };
      } else {
        s = { ...s, serverLog: [...s.serverLog, logEntry] };
      }

      s = applyAtom(s, atom);
    }

    if (!opts.skipHooks && hookReg) {
      const hooks = filterAsyncHooks(hookReg, atom.type, s.currentPlayer, s, atom);
      for (const hook of hooks) {
        const result = await runHookOnAfter(hook, { state: s, atom, self: s.currentPlayer, logEntry }, _resume?.resume);
        if (result.kind === 'modifyState') s = result.state;
        if (result.kind === 'additionalAtoms' && result.atoms.length > 0) {
          const sub = await applyAtomsAsync(
            s, result.atoms,
            { skipHooks: true, skipPlayerEvents: opts.skipPlayerEvents, asyncHooks: opts.asyncHooks },
            _recursionDepth + 1,
          );
          s = sub.state;
          logEntries.push(...sub.logEntries);
          if (sub.pending) {
            return { state: s, logEntries, playerViews, pending: sub.pending };
          }
          if (!opts.skipPlayerEvents) {
            for (const [player, views] of sub.playerViews) {
              const existing = playerViews.get(player);
              if (existing) existing.push(...views);
            }
          }
        }
        if (result.kind === 'pending') {
          return {
            state: s,
            logEntries,
            playerViews,
            pending: buildAsyncPending(result.def, hook.id, 'onAfter', atom, s.currentPlayer, result.tag),
          };
        }
      }
    }
  }

  return { state: s, logEntries, playerViews, pending: null };
}

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
  baseCtx: HookCtx,
  resumeData?: ResumeData,
): Promise<HookResult> {
  if (!hook.onBefore) return { kind: 'continue' };
  const ctx = injectHelpers(baseCtx);
  setCurrentHookContext({
    state: ctx.state,
    atom: ctx.atom,
    self: ctx.self,
    hookId: hook.id,
    awaiting: resumeData !== undefined,
    resume: resumeData,
  });
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
  baseCtx: HookCtx,
  resumeData?: ResumeData,
): Promise<HookResult> {
  if (!hook.onAfter) return { kind: 'continue' };
  const ctx = injectHelpers(baseCtx);
  setCurrentHookContext({
    state: ctx.state,
    atom: ctx.atom,
    self: ctx.self,
    hookId: hook.id,
    logEntry: ctx.logEntry,
    awaiting: resumeData !== undefined,
    resume: resumeData,
  });
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
function injectHelpers(baseCtx: HookCtx): HookCtx {
  const pending: HookCtx['pending'] = async <T>(def: PendingDef, tag?: Json) => {
    const cctx = getCurrentHookContext();
    if (!cctx) {
      throw new Error('ctx.pending() called outside AsyncHook context');
    }
    // eslint-disable-next-line no-console

    if (cctx.awaiting && cctx.resume && cctx.resume.kind === 'response') {
      // 恢复路径：unwrap response.value（pending<T> 的 T 就是 value 的类型）
      return cctx.resume.value as T | ResumeData;
    }
    if (cctx.awaiting) {
      // cancel / timeout
      return { kind: 'cancel' as const };
    }
    throw new PendingRequestSignal(def, tag);
  };
  const modifyState: HookCtx['modifyState'] = (state) => ({ kind: 'modifyState', state });
  const cancel: HookCtx['cancel'] = () => ({ kind: 'cancel' });
  const redirect: HookCtx['redirect'] = (target) => ({ kind: 'redirect', target });
  const additionalAtoms: HookCtx['additionalAtoms'] = (atoms) =>
    atoms.length === 0 ? { kind: 'continue' } : { kind: 'additionalAtoms', atoms };
  // 同步判定 helper：跑一次判定 atom 并返回结果。
  // 注意：直接调 applyAtom（不走钩子），且**写回** cctx.state 让后续 helper 看到。
  const judge: HookCtx['judge'] = (varKey) => {
    const cctx = getCurrentHookContext();
    if (!cctx) {
      throw new Error('ctx.judge() called outside AsyncHook context');
    }
    const judgeAtom = { type: '判定' as const, player: cctx.self, ...(varKey ? { varKey } : {}) };
    const newState = applyAtom(cctx.state, judgeAtom);
    // 把新 state 写回 cctx（同步覆盖）
    setCurrentHookContext({ ...cctx, state: newState });
    const local = newState.localVars ?? {};
    const cardId = (local['judgeCardId'] as string | null) ?? null;
    const suit = (local['judgeSuit'] as string) ?? '';
    const rank = (local['judgeRank'] as string) ?? '';
    const result = (suit === '♥' || suit === '♦') ? 'red' : 'black';
    return { cardId, suit, rank, result };
  };
  return { ...baseCtx, pending, judge, modifyState, cancel, redirect, additionalAtoms };
}

function buildAsyncPending(
  def: PendingDef,
  hookId: string,
  resumePoint: 'onBefore' | 'onAfter' | 'onResume',
  atom: Atom,
  self: string,
  tag?: Json,
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
  };
}
