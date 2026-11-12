// src/client/hooks/usePlayInteraction/common.ts
// 子 hook 共享类型(从 usePlayInteraction.ts 的 PlayInteractionParams.send 抽出)。

import type { Json } from '../../../engine/types';

/** 底层 send(GameView 的 WS 发送函数):主 action + 可选 preceding 链。 */
export type PlaySend = (
  skillId: string,
  actionType: string,
  params: Record<string, Json>,
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>,
) => void;
