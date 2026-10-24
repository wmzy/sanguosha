import type { AtomOfName, GameState, Json, TurnUsageAuthority } from '../types';
import { applyAtom } from '../core/apply';
import { viewMirrorKey } from './vars-keys';

type Usage = Omit<AtomOfName<'回合用量'>, 'type' | 'player'>;

/** 权威值 + 重连镜像的同步写入。同步执行,不在首个 await 后才预占用量。
 *
 *  镜像(`turn.vars['__view/...']`)必须与权威值同 tick 可见:buildView(初始/重连视图)
 *  据此重建 turnUsage,若延后到投影 atom 才写,稳定点读取会出现
 *  「authoritative 有、buildView 没有」或反之的漂移。 */
export function commitTurnUsage(state: GameState, player: number, usage: Usage): void {
  const self = state.players[player];
  if (!self) throw new Error(`player ${player} not found`);
  const writes = usage.authority === undefined ? [] : Array.isArray(usage.authority) ? usage.authority : [usage.authority];
  for (const write of writes as readonly TurnUsageAuthority[]) {
    const vars = write.scope === 'player' ? self.vars : state.turn.vars;
    const key = write.key ?? usage.key;
    const value = write.value === undefined ? usage.value : write.value;
    if (value === null) delete vars[key];
    else vars[key] = value;
  }
  const mirror = viewMirrorKey(player, usage.key);
  if (usage.value === null) delete state.turn.vars[mirror];
  else state.turn.vars[mirror] = usage.value;
}

/** 一组计数/已选目标必须同时预占,不能在两次投影之间被再次发动。
 *  投影 atom 非等待型,apply+atomHistory 入队在同步段完成;这里不再 await 它,
 *  让调用方(杀 的 onSettle 等)同步看到权威值,且投影事件与计数同 tick 可见。 */
export function setTurnUsages(state: GameState, player: number, usages: readonly Usage[]): Promise<void> {
  for (const usage of usages) commitTurnUsage(state, player, usage);
  for (const usage of usages) {
    void applyAtom(state, { type: '回合用量', player, ...usage }).catch((error: unknown) => {
      state.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  }
  return Promise.resolve();
}

/** 技能只能调用此入口,不再自行写 vars 后另发投影 atom。
 * authority 缺省表示纯派生公开投影,不会把转换态/距离等可见值写入错误的持久作用域。 */
export function setTurnUsage(
  state: GameState,
  player: number,
  key: string,
  value: Json,
  authority?: TurnUsageAuthority | readonly TurnUsageAuthority[],
): Promise<void> {
  return setTurnUsages(state, player, [{ key, value, authority }]);
}
