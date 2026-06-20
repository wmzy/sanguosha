// src/client/hooks/useSeatOrder.ts
// 座位排列 hook。从 GameView.tsx 提取。
//
// 自己始终在 result[0](底部中央);其余玩家从"上家"开始逆时针排,
// 这样弧形座位按 leftPct 从左到右呈现 [上家(左) ... 下家(右)],
// 符合三国杀惯例:自己正对面为逆时针出牌方向,自己的下家在右手侧。

import { useMemo } from 'react';
import type { GameView } from '../../engine/types';

/**
 * 计算以 perspectiveIdx 为中心的有序玩家列表。
 * @returns result[0] = perspectiveIdx;其后依次为上家、上上家、…、下家(逆时针)
 */
export function useSeatOrder(view: GameView, perspectiveIdx: number): typeof view.players {
  return useMemo(() => {
    const n = view.players.length;
    if (n === 0) return [] as typeof view.players;
    const result: typeof view.players = [view.players[perspectiveIdx]];
    for (let i = 1; i < n; i++) {
      // (perspectiveIdx - i + n) % n 走的是 [上家, 上上家, ..., 下家] 的逆时针路径
      result.push(view.players[(perspectiveIdx - i + n) % n]);
    }
    return result;
  }, [view.players, perspectiveIdx]);
}
