import type { ActionPrompt, Atom, GameState, PendingSlot, PendingView } from '../types';
import { TARGET_BROADCAST, TARGET_SYSTEM } from '../types';
import { getCardResponseMode, SILENT_RESPONSE_PROMPT } from '../core/card-response-availability';
import { resolveTimeoutMs } from '../core/timeout';
import { resolveChoosePlayerCandidates } from './choosePlayerCandidates';
import { resolveCardFilterCandidates } from './cardFilterCandidates';

const OBSERVABLE_TYPES = new Set(['询问闪', '询问杀', '请求回应', '出牌窗口']);
const WAITING_PROMPT: ActionPrompt = { type: 'confirm', title: '等待回应', cancelLabel: '' };

const publishedViews = new WeakMap<GameState['pendingSlots'], Map<number, { signature: string; pending: PendingView | null }>>();

function targetOf(atom: Atom): number {
  if ('target' in atom && typeof atom.target === 'number') return atom.target;
  if ('player' in atom && typeof atom.player === 'number') return atom.player;
  return TARGET_SYSTEM;
}

function visibleSlot(state: GameState, viewer: number): PendingSlot | undefined {
  const alive = viewer >= 0 && state.players[viewer]?.alive === true;
  const own = alive ? state.pendingSlots.get(viewer) : undefined;
  if (own && !own.isPaused) return own;
  if (alive) {
    const broadcast = [...state.pendingSlots.values()].find(
      (slot) => !slot.isPaused && targetOf(slot.atom) === TARGET_BROADCAST,
    );
    if (broadcast) return broadcast;
  }
  return [...state.pendingSlots.values()].find((slot) => {
    const target = targetOf(slot.atom);
    return !slot.isPaused && target >= 0 && target !== viewer && OBSERVABLE_TYPES.has(slot.atom.type);
  });
}

function rawPrompt(slot: PendingSlot): ActionPrompt {
  const atom = slot.atom;
  if (atom.type === '选将询问') {
    return atom.prompt ?? { type: 'chooseCharacter', title: '请选择武将', candidates: atom.candidates };
  }
  // 防御:atom 未带 prompt(历史上 请求回应.prompt 在类型上必填,但旧客户端/构造路径可缺省)
  // 且 atom 定义也没给默认 prompt 时,退化为不可操作的确认提示,不让投影抛错。
  return (
    ('prompt' in atom ? atom.prompt : undefined) ??
    slot.definition.pending!.prompt ??
    { type: 'confirm' as const, title: '请回应' }
  );
}

/** Remove private atom fields even for observers: prompt candidates must never leak through atom. */
function publicAtom(atom: Atom, prompt?: ActionPrompt): Atom {
  switch (atom.type) {
    case '请求回应':
      return {
        type: atom.type, target: atom.target, requestType: atom.requestType,
        ...(atom.cancelTarget !== undefined ? { cancelTarget: atom.cancelTarget } : {}),
        ...(prompt ? { prompt } : {}),
      } as Atom;
    case '询问闪':
    case '询问杀':
      return { type: atom.type, target: atom.target, source: atom.source };
    case '出牌窗口':
      return { type: atom.type, player: atom.player };
    case '选将询问':
      return { type: atom.type, target: atom.target, candidates: [] };
    default:
      return atom;
  }
}

/** The sole visible-pending projection, shared by initial/reconnect views and incremental events. */
export function projectVisiblePending(state: GameState, viewer: number): PendingView | null {
  const slot = visibleSlot(state, viewer);
  if (!slot) return null;
  const target = targetOf(slot.atom);
  const actionable = target === viewer || (target === TARGET_BROADCAST && state.players[viewer]?.alive === true);
  const mode = actionable ? getCardResponseMode(state, slot.atom) : undefined;
  const prompt = !actionable ? WAITING_PROMPT : mode === 'silent' ? SILENT_RESPONSE_PROMPT
    : resolveCardFilterCandidates(resolveChoosePlayerCandidates(rawPrompt(slot), state), state, viewer);
  const visibleAtom = slot.atom.type === '选将询问' && actionable
    ? {
        type: '选将询问',
        target: slot.atom.target,
        candidates: slot.atom.candidates,
      } as unknown as Atom
    : publicAtom(slot.atom, actionable && mode !== 'silent' ? prompt : undefined);
  const totalMs = slot.resolvedTimeoutMs ?? resolveTimeoutMs(
    state,
    ('timeout' in slot.atom ? slot.atom.timeout : undefined) ?? slot.definition.pending!.timeout,
    target < 0,
  );
  const pending: PendingView = {
    type: 'awaits', atom: visibleAtom,
    prompt, target, isBlocking: slot.isBlocking,
    ...(slot.atom.type === '请求回应' && slot.atom.mandatory === true ? { mandatory: true } : {}),
    ...(mode ? { responseMode: mode === 'silent' ? 'silent' : 'normal' } : {}),
    deadline: state.startedAt + slot.deadline, totalMs,
  };
  return pending;
}

/** Publish immutable, separately sequenced metadata only when a viewer's visible slot changes.
 * Parallel slot creation and pause/resume may happen without a new atom; never overwrite an old seq. */
export function publishPendingChanges(state: GameState): void {
  let previous = publishedViews.get(state.pendingSlots);
  if (!previous) publishedViews.set(state.pendingSlots, previous = new Map());
  const changes: Record<string, PendingView | null> = {};
  for (let viewer = -1; viewer < state.players.length; viewer++) {
    const next = projectVisiblePending(state, viewer);
    const signature = JSON.stringify(next);
    const before = previous.get(viewer);
    if (!before) {
      previous.set(viewer, { signature, pending: next });
      if (next === null) continue;
      changes[String(viewer)] = JSON.parse(JSON.stringify(next)) as PendingView;
      continue;
    }
    if (before.signature === signature) continue;
    changes[String(viewer)] = next === null ? null : JSON.parse(JSON.stringify(next)) as PendingView;
    previous.set(viewer, { signature, pending: next });
  }
  if (Object.keys(changes).length === 0) return;
  // pending 快照是独立序号的事件:并行 slot 创建 / pause-resume 可能不产生新 atom,
  // 必须有自己的 seq 才能被增量订阅(eventsForViewer 按 sinceSeq 水位过滤)取到。
  state.seq += 1;
  state.atomHistory.push({
    kind: 'notify', seq: state.seq, timestamp: state.clock.now() - state.startedAt,
    skillId: '', eventType: 'pendingChanged', data: {}, pendingViews: changes,
    // The metadata notification itself is private; eventsForViewer emits only the viewer's snapshot.
    views: new Map(),
  });
}
