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
import { DISTANCE_ATTACK_RANGE_KEY } from '../rules/vars-keys';

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

/** 快照覆盖清单之外的 PlayerState 字段:座次/身份/昵称等由开局或分配武将一次性写入,
 *  不属于任何技能的 preceding 代价,故不参与回滚快照。 */
type ExcludedPlayerField = 'index' | 'name' | 'nickname' | 'identity' | 'faction';

/** 编译期覆盖检查(单向):PlayerState 新增可变字段必须登记进 PLAYER_SNAPSHOT_FIELDS
 *  或列入 ExcludedPlayerField,否则 tsc 直接报错。
 *  背景:字段表靠手工维护,漏登记 = 拒绝路径不回滚该字段,客户端可见状态静默漂移。 */
type SnapshottedPlayerField = (typeof PLAYER_SNAPSHOT_FIELDS)[number]['key'] | 'judgeZone';
type UncoveredPlayerField = Exclude<keyof PlayerState, SnapshottedPlayerField | ExcludedPlayerField>;
const _assertPlayerSnapshotCoversAll: UncoveredPlayerField extends never ? true : never = true;
/** 反向检查:排除清单不得残留已删除/拼错的字段名(否则排除清单静默失效)。 */
type StaleExcludedPlayerField = Exclude<ExcludedPlayerField, keyof PlayerState>;
const _assertNoStaleExcludedField: StaleExcludedPlayerField extends never ? true : never = true;
void _assertPlayerSnapshotCoversAll;
void _assertNoStaleExcludedField;

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

/** 公共基线字段:构造点无条件赋值,且被 dispatch 中无法按 enabled 收窄的调用方读取
 *  (rejectRolledBack 无条件调 pending.cleanupResidual;flush 缓冲在 hasPreceding
 *  分支回填 viewBuffering——TS 无法经无关布尔变量 hasPreceding 收窄联合)。 */
interface DispatchSnapshotBase {
  /** pending 基线:拒绝路径无条件调用 cleanupResidual(enabled=false 时
   *  created 恒空,no-op)。 */
  readonly pending: PendingTracker;
  /** 进缓冲前的原 viewBuffering 值。 */
  readonly viewBuffering: boolean;
}

/** enabled=false(消息无 preceding):拒绝路径不会 mutate 玩家可见状态,
 *  不构造重快照字段;restoreState 提前 return 不做任何还原。 */
interface DispatchSnapshotDisabled extends DispatchSnapshotBase {
  readonly enabled: false;
}

/** enabled=true(消息带 preceding):preceding 执行前对 state 全部可变字段的
 *  逐项快照,各字段必填非空(构造点无条件赋值)。 */
interface DispatchSnapshotEnabled extends DispatchSnapshotBase {
  readonly enabled: true;
  /** 玩家逐字段快照(不整对象替换:在线 execute 可能持有 player/zone 引用,
   *  替换引用会让正在恢复的父流程读写到孤儿对象)。 */
  readonly players: readonly PlayerSnapshot[];
  readonly cardMap: Record<string, Card>;
  readonly cardWrappers: GameState['cardWrappers'];
  readonly localVars: GameState['localVars'];
  readonly turn: GameState['turn'];
  readonly atomStack: GameState['atomStack'];
  readonly settlementStack: GameState['settlementStack'];
  readonly zones: GameState['zones'];
  readonly marks: GameState['marks'];
  readonly currentPlayerIndex: number;
  readonly phase: GameState['phase'];
  readonly rngSeed: number;
  readonly actionLogLength: number;
  readonly atomHistoryLength: number;
  readonly seq: number;
}

/** dispatch 拒绝路径的整体快照:判别联合,消费端(restoreState)按 enabled 收窄,
 *  无需任何非空断言。 */
export type DispatchSnapshot = DispatchSnapshotDisabled | DispatchSnapshotEnabled;

/** dispatch 入口(preceding 执行前)对 state 做整体快照。
 *  enabled = 消息带 preceding:无 preceding 的拒绝路径不会 mutate 玩家可见状态,
 *  仅保留公共基线 pending/viewBuffering(cleanupResidual 对空 created 集合为 no-op)。 */
export function snapshotState(state: GameState, enabled: boolean): DispatchSnapshot {
  if (!enabled) {
    return {
      enabled: false,
      pending: createPendingTracker(state),
      viewBuffering: state.viewBuffering === true,
    };
  }
  return {
    enabled: true,
    pending: createPendingTracker(state),
    viewBuffering: state.viewBuffering === true,
    players: state.players.map(snapshotPlayer),
    cardMap: { ...state.cardMap },
    cardWrappers: structuredClone(state.cardWrappers),
    localVars: structuredClone(state.localVars),
    turn: structuredClone(state.turn),
    atomStack: [...state.atomStack],
    settlementStack: [...state.settlementStack],
    zones: {
      deck: [...state.zones.deck],
      discardPile: [...state.zones.discardPile],
      processing: [...state.zones.processing],
    },
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    rngSeed: state.rngSeed,
    marks: structuredClone(state.marks),
    actionLogLength: state.actionLog.length,
    atomHistoryLength: state.atomHistory.length,
    seq: state.seq,
  };
}

/** 按快照整体还原 state(原 rollbackPreceding 的 finally 块,纯搬移)。
 *  顺序敏感:牌面(cardMap,就地还原保持引用)→ 玩家(装备 vars 重建要读 cardMap 的
 *  原武器 range)→ 顶层字段 + pendingSlots 恢复 + 日志/seq 截断。 */
export function restoreState(state: GameState, snap: DispatchSnapshot): void {
  if (!snap.enabled) return;
  // 牌面先还原(就地 delete + assign,保持 state.cardMap 引用不变)。
  for (const id of Object.keys(state.cardMap)) {
    if (!(id in snap.cardMap)) delete state.cardMap[id];
  }
  Object.assign(state.cardMap, snap.cardMap);
  for (let i = 0; i < snap.players.length; i++) {
    const p = state.players[i];
    if (!p) continue;
    restorePlayer(p, snap.players[i]);
    // rollback 回调可恢复装备槽位；用装备牌面重建依赖 vars，避免快照中的旧
    // 直接构造状态没有通过「装备」atom而缺少距离变量。
    const weaponId = p.equipment['武器'];
    if (weaponId) {
      const weapon = state.cardMap[weaponId];
      if (weapon?.range !== undefined) p.vars[DISTANCE_ATTACK_RANGE_KEY] = weapon.range;
    }
  }
  state.zones.deck = [...snap.zones.deck];
  state.zones.discardPile = [...snap.zones.discardPile];
  state.zones.processing = [...snap.zones.processing];
  state.cardWrappers = structuredClone(snap.cardWrappers);
  state.localVars = snap.localVars;
  state.turn = structuredClone(snap.turn);
  state.currentPlayerIndex = snap.currentPlayerIndex;
  state.phase = snap.phase;
  state.rngSeed = snap.rngSeed;
  state.marks = structuredClone(snap.marks);
  state.atomStack = snap.atomStack;
  state.settlementStack = snap.settlementStack;
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
