// 回合用量:view 侧同步"本回合用量计数/限一次标记",供前端禁用超限/已用操作。
//
// 为什么需要它:后端用 state.turn.vars['杀/quotaUsed'+'杀/extraUsed'](出杀计数,合计=slashUsed())与
// state.players[i].vars['制衡/usedThisTurn'](限一次)判断操作合法性。
// 但这两个 vars 的变化不经 atom(技能 execute 直接 mutate),processedView
// (事件流增量)无法感知 → 前端读 view.turn.vars 永远是 baseline 旧值,
// "和后端一致"做不到。本 atom 是纯 view 同步通道:技能 execute 在同步设好
// state 侧 vars 后,紧接着 applyAtom('回合用量') 把同一个值同步到
// view.players[i].turnUsage,经 toViewEvents→广播→client applyView 链路
// 让前端实时拿到正确用量。
//
// 设计约束:
//   - apply 为 no-op:state 侧 vars 由技能 execute 同步维护(限一次标记必须在
//     execute 第一个 await 之前设置以防 dispatch 重入,见制衡.ts 注释)。
//     本 atom 只负责把"已设好的值"投影到 view,不重复改 state。
//   - 通用 key:value 约定:数字 key 表示已用次数('杀/usedCount'),
//     真值 key 表示限一次标记('* /usedThisTurn')。前端 activeWhen 按需读取。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent, Json } from '../types';
import { viewMirrorKey } from '../rules/vars-keys';

export const 回合用量: AtomDefinition<{ player: number; key: string; value: Json }> = {
  type: '回合用量',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    // 按玩家归属保存镜像，覆盖被借刀/挑衅/激将等在他人回合触发的用量。
    // key 保持原样，仅在 turn.vars 中增加玩家维度，buildView 可按玩家重建。
    const mirror = viewMirrorKey(atom.player, atom.key);
    if (atom.value === null) delete state.turn.vars[mirror];
    else state.turn.vars[mirror] = atom.value;
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '回合用量',
      player: atom.player,
      key: atom.key,
      value: atom.value,
    };
    // 用量信息对所有人可见(出杀次数/限一次是公开信息),用 othersView 广播。
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view: GameView, event) {
    const p = view.players[event.player as number];
    if (!p) return;
    p.turnUsage ??= {};
    const key = event.key as string;
    if (event.value === null) {
      delete p.turnUsage[key];
      return;
    }
    p.turnUsage[key] = event.value as Json;
  },
};

