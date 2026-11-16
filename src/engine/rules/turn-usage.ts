import type { AtomOfName, GameState, Json, TurnUsageAuthority } from '../types';
import { applyAtom } from '../core/apply';
import { viewMirrorKey, clearPerTurnState, PER_TURN_SUFFIXES } from './vars-keys';

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

// ────────────────────────── 参数化 key 的通用发射器(静态契约豁免层) ──────────────────────────
// 由 turnUsage 投影 key 静态契约(tests/engine/turnUsage-projection-meta.test.ts)约束:
// 参数化 key 的投影发射必须住在本层(本文件豁免);其余文件的 key 表达式必须是
// vars-keys 注册表常量/工厂或技能名模板,函数参数名作 key 会被判违规。
// 消费方:createYinYangState — 阴阳转换技(审时/成略/拒战/贞良);
//         clearPerTurnStateProjected — 放权(cancel 回合结束路径)。

/** 阴阳转换技(审时/成略/拒战/贞良)的转换态读写工厂。
 *  state 真相在 player.vars(跨回合持久,缺省 '阳'),此处仅把转换态投影到 view.turnUsage:
 *  getState 读权威值;syncStateView 在发动翻转后与拥有者「回合开始」重同步时调用。
 *  key 须由调用方以注册表常量(审时/成略/拒战)或本文件局部字面量(贞良)声明后传入。 */
export function createYinYangState(stateKey: string): {
  getState: (state: GameState, ownerId: number) => '阳' | '阴';
  syncStateView: (state: GameState, ownerId: number) => Promise<void>;
} {
  const getState = (state: GameState, ownerId: number): '阳' | '阴' =>
    state.players[ownerId]?.vars[stateKey] === '阴' ? '阴' : '阳';
  const syncStateView = async (state: GameState, ownerId: number): Promise<void> => {
    await projectTurnUsage(state, ownerId, stateKey, getState(state, ownerId));
  };
  return { getState, syncStateView };
}

/** per-turn 清理的投影版:先按 PER_TURN_SUFFIXES 逐 key 投影 null,再复用 vars-keys 的
 *  clearPerTurnState(清 turn.vars、duration='turn' 标记、后缀 vars——本身不产生 atom)。
 *  消费方:放权 cancel 回合结束路径——cancel 后 回合结束.applyView 不执行,增量视图的
 *  turnUsage 只能靠「回合用量」atom 逐 key 清漏;权威「回合结束」atom 靠自身 applyView
 *  整体清空,不走本入口。atom 序列与放权此前的本地实现逐 atom 一致:玩家序 × key 插入序。 */
export async function clearPerTurnStateProjected(state: GameState): Promise<void> {
  for (const p of state.players) {
    for (const key of Object.keys(p.vars)) {
      if (PER_TURN_SUFFIXES.some((suffix) => key.endsWith(suffix))) {
        await projectTurnUsage(state, p.index, key, null);
      }
    }
  }
  clearPerTurnState(state);
}
