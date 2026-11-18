// 兵粮寸断 CardEffect — 延时锦囊·兵粮寸断的使用结算。
//
// 与乐不思蜀对称(canUse/resolve/放置与校验的单源实现见 cards/_delayedSkipEffect):
//   判定 ♣   → 无效,弃置
//   判定非♣ → 跳过摸牌阶段(加标签,摸牌阶段 before-hook 消费)
// 使用时目标须距离1内(奇才豁免),view 侧投影见 cards/_distanceOne。
import { createDelayedSkipEffect } from './_delayedSkipEffect';

export const supplyShortageEffect = createDelayedSkipEffect({
  trickName: '兵粮寸断',
  failSuit: '♣',
  skipTag: '兵粮寸断/跳过摸牌',
  phase: '摸牌',
  withDistance: true,
});
