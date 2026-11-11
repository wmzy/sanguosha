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

// ── 技能侧「state 真相 + view 投影」单点 helper ──────────────
//
// 各技能原先手写两类样板,均须与 key 字符串逐字节一致,漏一侧即 desync:
//   1. 纯投影:await applyAtom(state, { type: '回合用量', player, key, value })
//      (state 真相由调用方维护,常为不同 key 的私有 vars——如 奇谋 的 provider 标记)
//   2. 成对写入:vars[key] = value; await applyAtom(同 key 同 value)
// 下列 helper 把两类样板的 atom 形状收敛到本模块;与既有调用点时序逐字节一致
// (完整等待 atom 管线,不走 setTurnUsages 的 fire-and-forget)。

/** 纯 view 投影(无 state 权威写入):经「回合用量」atom 把 key/value 同步到
 *  view.turnUsage 与 turn.vars 镜像。state 真相由调用方自行维护。 */
export async function projectTurnUsage(
  state: GameState,
  player: number,
  key: string,
  value: Json,
): Promise<void> {
  await applyAtom(state, { type: '回合用量', player, key, value });
}

/** state 真相 + view 投影一步提交(player.vars 权威,同 key 同值)。
 *  替代 `vars[key]=value; await applyAtom(回合用量)` 成对手写
 *  (强袭/界强袭/界挑衅 限次计数、界燕语 lostSha 等回合内标记)。 */
export async function setPlayerVarUsage(
  state: GameState,
  player: number,
  key: string,
  value: Json,
): Promise<void> {
  state.players[player].vars[key] = value;
  await applyAtom(state, { type: '回合用量', player, key, value });
}

/** state 真相 + view 投影一步提交(turn.vars 权威,同 key 同值)。
 *  双雄/界双雄 颜色、决堰 坐骑距离豁免、界当先 无距离杀等具名键。
 *  注意:state 值与 view 值不同(如存座次 vs 投影 true)的场合不可用,走 projectTurnUsage。 */
export async function setTurnVarUsage(
  state: GameState,
  player: number,
  key: string,
  value: Json,
): Promise<void> {
  state.turn.vars[key] = value;
  await applyAtom(state, { type: '回合用量', player, key, value });
}
