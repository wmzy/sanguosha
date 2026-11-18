// skills/cards/_distanceOne.ts — 「距离1内 + 奇才豁免」目标判定的单一来源。
//
// 兵粮寸断/顺手牵羊 的「距离1内其他角色」判据原先散落三处、各写一份:
//   - 引擎侧 canUse(奇才豁免 + effectiveDistance<=1,两卡逐字重复)
//   - view 侧 prompt.targetFilter.filter(viewEffectiveDistance 投影,两卡逐字重复)
//   - validate.ts isLegalTarget 的 distance case(奇才豁免判据)
// 三处必须同源:引擎放行但 view 漏投影 = 客户端目标置灰发不出;反之 = 枚举出必拒目标。
// 兵粮寸断的延时锦囊工厂(cards/_delayedSkipEffect)同样消费本模块。
import type { GameState, GameView } from '../../types';
import { effectiveDistance } from '../../rules/distance';
import { viewEffectiveDistance } from '../../rules/viewDistance';

/** 奇才/界奇才 持久豁免 tag(两技能文件各自导出 QICAI_TAG 同字面量;
 *  此处不 import 技能文件,避免 cards → skills 反向依赖)。 */
const QICAI_NO_DISTANCE_TAG = '奇才/无距离限制';

/** 奇才(无距离限制)豁免判据 —— validate.ts 的 distance case 与
 *  distanceWithinOneOk 共用同一份判断。 */
export function hasNoDistanceLimit(state: GameState, ownerId: number): boolean {
  return !!state.players[ownerId]?.tags.includes(QICAI_NO_DISTANCE_TAG);
}

/** 引擎侧:ownerId 对 target 是否满足「距离1内」(含奇才豁免)。
 *  顺手牵羊/兵粮寸断 的 canUse 距离守卫同源消费。 */
export function distanceWithinOneOk(
  state: GameState,
  ownerId: number,
  target: number,
  cardId?: string,
): boolean {
  return (
    hasNoDistanceLimit(state, ownerId) || effectiveDistance(state, ownerId, target, cardId) <= 1
  );
}

/** view 侧:「距离1内其他角色」目标过滤(distanceWithinOneOk 的同源投影)。
 *  兵粮寸断/顺手牵羊 的 prompt.targetFilter.filter 直接引用。 */
export function distanceOneTargetFilter(view: GameView, target: number): boolean {
  if (target === view.currentPlayerIndex) return false;
  const tp = view.players[target];
  if (!tp || tp.alive === false) return false;
  if (view.players[view.currentPlayerIndex]?.tags?.includes(QICAI_NO_DISTANCE_TAG)) return true;
  return viewEffectiveDistance(view.players, view.currentPlayerIndex, target) <= 1;
}
