// core/rollback.ts — dispatch 拒绝路径的快照/回滚机制(自 core/index.ts 拆出,纯搬移)。
//
// preceding(转化技的 当作/去标记 等)会直接 mutate players[i].hand / marks,而各技能
// rollback 回调的恢复方式不一致(多张牌 push 回末尾、单张写回影子卡位置),两者都会把
// 原牌/原标记挪到数组末尾。手牌与标记顺序是客户端可见状态(UI 排列 + pickTargetCard
// 盲选的 handIndex 按位置取值),被拒动作不得改动它——否则在线客户端(增量视图看不到
// 被回滚的 preceding 事件)与权威 buildView 顺序不一致,玩家按位置选到的牌与点击的
// 不是同一张。故 dispatch 在跑 preceding 之前对全部可变字段做快照,任一 reject 路径
// 按快照整体还原(内容 + 顺序)。
import type { Card, GameState, PendingSlot, PlayerState } from '../types';

/** 单字段的拷贝语义。快照与还原两个方向共用同一语义(快照拷一次、还原再拷一次,
 *  快照对象本体永不落入活状态,重复还原也安全)。 */
type CopyKind =
  /** 数组浅拷贝([...x]):元素为不可变牌 id 字符串,浅拷贝即隔离。 */
  | 'spread'
  /** structuredClone 深拷贝:嵌套对象(vars/marks/pendingTricks)整体隔离。 */
  | 'clone'
  /** 对象浅展开({...x}):装备槽位表,值为不可变牌 id。 */
  | 'object'
  /** 标量直赋:number/boolean/string 无需拷贝。 */
  | 'scalar';

/** 玩家逐字段快照表(key 列表驱动,消灭「手写赋值 ×2」的漂移风险)。
 *  ⚠ PlayerState 新增可变字段必须同步登记此处——漏登记 = 拒绝路径不回滚该字段,
 *  客户端可见状态静默漂移(index/name/nickname/identity/faction 为只读元数据,不快照)。 */
const PLAYER_SNAPSHOT_FIELDS: ReadonlyArray<{
  key: Exclude<keyof PlayerState, 'judgeZone'>;
  copy: CopyKind;
}> = [
  { key: 'hand', copy: 'spread' },
  { key: 'marks', copy: 'clone' },
  { key: 'vars', copy: 'clone' },
  { key: 'equipment', copy: 'object' },
  { key: 'tags', copy: 'spread' },
  { key: 'pendingTricks', copy: 'clone' },
  { key: 'skills', copy: 'spread' },
  { key: 'health', copy: 'scalar' },
  { key: 'maxHealth', copy: 'scalar' },
  { key: 'alive', copy: 'scalar' },
  { key: 'character', copy: 'scalar' },
];

/** 按语义拷贝单个字段值(快照/还原共用)。 */
function copyByKind(value: unknown, copy: CopyKind): unknown {
  switch (copy) {
    case 'spread':
      return [...(value as unknown[])];
    case 'clone':
      return structuredClone(value);
    case 'object':
      return { ...(value as Record<string, unknown>) };
    case 'scalar':
      return value;
  }
}

/** 单个玩家的逐字段快照(judgeZone 可选,单独条件拷贝)。 */
interface PlayerSnapshot {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly judgeZone: string[] | undefined;
}

function snapshotPlayer(p: PlayerState): PlayerSnapshot {
  const source = p as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const { key, copy } of PLAYER_SNAPSHOT_FIELDS) {
    fields[key] = copyByKind(source[key], copy);
  }
  return { fields, judgeZone: p.judgeZone ? [...p.judgeZone] : undefined };
}

function restorePlayer(p: PlayerState, snap: PlayerSnapshot): void {
  const target = p as unknown as Record<string, unknown>;
  for (const { key, copy } of PLAYER_SNAPSHOT_FIELDS) {
    target[key] = copyByKind(snap.fields[key], copy);
  }
  if (snap.judgeZone) p.judgeZone = [...snap.judgeZone];
  else delete p.judgeZone;
}

/** pending 槽追踪:dispatch 入口记录既有槽,preceding 每步 execute 后登记新建槽。
 *  拒绝路径只清理由本次 preceding 新创建的 slot——旧 slot 可能属于其他玩家正在等待的
 *  流程,绝不能因本次 action 被拒而 resolve/delete。 */
export interface PendingTracker {
  /** 本轮新建的 slot(restoreState 恢复 pendingSlots 时亦按此判定)。 */
  readonly created: ReadonlySet<PendingSlot>;
  /** 快照时刻的 pendingSlots 条目(key → 旧 slot),回滚时恢复被新建槽覆盖的 key。 */
  readonly entriesSnapshot: ReadonlyMap<number, PendingSlot>;
  /** preceding 每步 execute 后调用:把新出现的 slot 记入 created。 */
  trackNew(): void;
  /** 拒绝路径收尾:resolve 并移除本轮新建的 slot。 */
  cleanupResidual(): void;
}

function createPendingTracker(state: GameState): PendingTracker {
  const entriesSnapshot = new Map(state.pendingSlots);
  const baseline = new Set(state.pendingSlots.values());
  const created = new Set<PendingSlot>();
  return {
    created,
    entriesSnapshot,
    trackNew: () => {
      for (const slot of state.pendingSlots.values()) {
        if (!baseline.has(slot)) created.add(slot);
      }
    },
    cleanupResidual: () => {
      for (const [key, slot] of state.pendingSlots) {
        if (!created.has(slot)) continue;
        if (state.pendingSlots.get(key) === slot) state.pendingSlots.delete(key);
        slot.resolve();
      }
    },
  };
}

/** dispatch 拒绝路径的整体快照:preceding 执行前对 state 全部可变字段的逐项快照。 */
export interface DispatchSnapshot {
  /** 是否启用快照(= 消息带 preceding)。false 时 restoreState 不做任何还原。 */
  readonly enabled: boolean;
  /** 玩家逐字段快照(不整对象替换:在线 execute 可能持有 player/zone 引用,
   *  替换引用会让正在恢复的父流程读写到孤儿对象)。 */
  readonly players: readonly PlayerSnapshot[] | null;
  readonly cardMap: Record<string, Card> | null;
  readonly cardWrappers: GameState['cardWrappers'] | null;
  readonly localVars: GameState['localVars'] | null;
  readonly turn: GameState['turn'] | null;
  readonly atomStack: GameState['atomStack'] | null;
  readonly settlementStack: GameState['settlementStack'] | null;
  readonly zones: GameState['zones'] | null;
  readonly marks: GameState['marks'] | null;
  readonly currentPlayerIndex: number;
  readonly phase: GameState['phase'];
  readonly rngSeed: number;
  readonly actionLogLength: number;
  readonly atomHistoryLength: number;
  readonly seq: number;
  readonly viewBuffering: boolean;
  readonly pending: PendingTracker;
}

/** dispatch 入口(preceding 执行前)对 state 做整体快照。
 *  enabled = 消息带 preceding:无 preceding 的拒绝路径不会 mutate 玩家可见状态,
 *  仅保留标量与 pending 基线(cleanupResidual 对空 created 集合为 no-op)。 */
export function snapshotState(state: GameState, enabled: boolean): DispatchSnapshot {
  return {
    enabled,
    players: enabled ? state.players.map(snapshotPlayer) : null,
    cardMap: enabled ? { ...state.cardMap } : null,
    cardWrappers: enabled ? structuredClone(state.cardWrappers) : null,
    localVars: enabled ? structuredClone(state.localVars) : null,
    turn: enabled ? structuredClone(state.turn) : null,
    atomStack: enabled ? [...state.atomStack] : null,
    settlementStack: enabled ? [...state.settlementStack] : null,
    zones: enabled
      ? {
          deck: [...state.zones.deck],
          discardPile: [...state.zones.discardPile],
          processing: [...state.zones.processing],
        }
      : null,
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    rngSeed: state.rngSeed,
    marks: enabled ? structuredClone(state.marks) : null,
    actionLogLength: state.actionLog.length,
    atomHistoryLength: enabled ? state.atomHistory.length : 0,
    seq: state.seq,
    viewBuffering: state.viewBuffering === true,
    pending: createPendingTracker(state),
  };
}

/** 按快照整体还原 state(原 rollbackPreceding 的 finally 块,纯搬移)。
 *  顺序敏感:牌面(cardMap,就地还原保持引用)→ 玩家(装备 vars 重建要读 cardMap 的
 *  原武器 range)→ 顶层字段 + pendingSlots 恢复 + 日志/seq 截断。 */
export function restoreState(state: GameState, snap: DispatchSnapshot): void {
  if (!snap.enabled) return;
  // 牌面先还原(就地 delete + assign,保持 state.cardMap 引用不变)。
  if (snap.cardMap) {
    for (const id of Object.keys(state.cardMap)) {
      if (!(id in snap.cardMap)) delete state.cardMap[id];
    }
    Object.assign(state.cardMap, snap.cardMap);
  }
  if (snap.players) {
    for (let i = 0; i < snap.players.length; i++) {
      const p = state.players[i];
      if (!p) continue;
      restorePlayer(p, snap.players[i]);
      // rollback 回调可恢复装备槽位；用装备牌面重建依赖 vars，避免快照中的旧
      // 直接构造状态没有通过「装备」atom而缺少距离变量。
      const weaponId = p.equipment['武器'];
      if (weaponId) {
        const weapon = state.cardMap[weaponId];
        if (weapon?.range !== undefined) p.vars['距离/出杀范围'] = weapon.range;
      }
    }
  }
  state.zones.deck = [...snap.zones!.deck];
  state.zones.discardPile = [...snap.zones!.discardPile];
  state.zones.processing = [...snap.zones!.processing];
  state.cardWrappers = structuredClone(snap.cardWrappers!);
  state.localVars = snap.localVars!;
  state.turn = structuredClone(snap.turn!);
  state.currentPlayerIndex = snap.currentPlayerIndex;
  state.phase = snap.phase;
  state.rngSeed = snap.rngSeed;
  state.marks = structuredClone(snap.marks!);
  state.atomStack = snap.atomStack!;
  state.settlementStack = snap.settlementStack!;
  for (const [key, slot] of state.pendingSlots) {
    if (!snap.pending.created.has(slot)) continue;
    state.pendingSlots.delete(key);
    slot.resolve();
    const previous = snap.pending.entriesSnapshot.get(key);
    if (previous) state.pendingSlots.set(key, previous);
  }
  state.actionLog.length = snap.actionLogLength;
  state.atomHistory.length = snap.atomHistoryLength;
  state.seq = snap.seq;
  state.viewBuffering = snap.viewBuffering;
}
