// 乐不思蜀 CardEffect — 延时锦囊·乐不思蜀的使用结算。
//
// 延迟类锦囊:runUseFlow 置入判定区后暂停(delayed=true),
// 判定阶段由 resumeDelayedSettlement 恢复使用结算中,resolve 执行判定+效果。
//
// 生效后效果(use.md):判定 ♥ → 无效,弃置;判定非 ♥ → 跳过出牌阶段
// (加标签,出牌阶段 before-hook 消费)。使用无距离限制。
// canUse/resolve/放置与校验的单源实现见 cards/_delayedSkipEffect。
import { createDelayedSkipEffect } from './_delayedSkipEffect';

export const indulgenceEffect = createDelayedSkipEffect({
  trickName: '乐不思蜀',
  failSuit: '♥',
  skipTag: '乐不思蜀/跳过出牌',
  phase: '出牌',
  withDistance: false,
});
