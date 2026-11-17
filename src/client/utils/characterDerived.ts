// src/client/utils/characterDerived.ts
// 玩家可见状态的派生布尔:座位卡(PlayerSeatView)与视角大卡(PlayerCardLarge)
// 此前各留一份平行实现,收敛于此单一事实来源,避免两份漂移。
// 与 utils/characterVisuals(视觉派生)分工:此处只做纯布尔判定,不涉样式。

import type { GameView } from '../../engine/types';

/** 阵亡:alive 为 false(死亡印章/置灰/立绘 grayscale 的判据)。 */
export function isPlayerDead(
  player: Pick<GameView['players'][number], 'alive'>,
): boolean {
  return !player.alive;
}

/** 横置(铁索连环):marks 含 'chained' —— 卡边框铁链光泽 + 立绘冷色调 + 连环徽章。 */
export function isPlayerChained(
  player: Pick<GameView['players'][number], 'marks'>,
): boolean {
  return player.marks.some((m) => m.id === 'chained');
}
