// 前端共享类型定义。
//
// 本文件集中存放跨组件/hook 复用、且不属于 engine/server 层的前端专用类型,
// 消除在多处重复定义同一类型的问题。

import type { Json } from '../engine/types';

/** 前端发给 controller 的 action 消息(不含 baseSeq)。
 *  GameView 产生 → useDebugMultiConnection 注入 baseSeq/pendingSeq → 发 WS。
 *  唯一定义点;GameView.tsx 和 useDebugMultiConnection.ts 共享。 */
export interface ActionMsg {
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
  /** 组合 action:在主 action 前顺序执行的前置 action(转化类,如武圣) */
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
}
