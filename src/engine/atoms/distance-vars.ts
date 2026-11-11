// distanceVars 增量合并 helper:「加标记/去标记/添加技能」三处 applyView 共用的
// view 同步逻辑收敛于此。事件携带的距离修正增量(delta)展开合并进玩家 view 投影;
// value 为 undefined 的 key 用于清除 view 侧对应字段(与 去标记 的清除语义一致)。
import type { GameView } from '../types';

/** 距离修正增量(view 同步通道,见 types/atom.ts 加标记/去标记 的 distanceVars 字段)。 */
export type DistanceVarsDelta = { attackMod?: number; defenseMod?: number; attackRange?: number };

/** 把 delta 合并进 playerView.distanceVars(原地 mutate;delta 缺失时不动)。 */
export function mergeDistanceVars(
  playerView: GameView['players'][number],
  delta: DistanceVarsDelta | undefined,
): void {
  if (!delta) return;
  playerView.distanceVars = { ...playerView.distanceVars, ...delta };
}
