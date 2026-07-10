// src/client/replay/types.ts
// 录像格式定义:纯前端录制,逐 atom 事件。
//
// 录像 = meta + 每座次的独立事件流。每条 event 对应一个 atom 的 ViewEvent,
// 回放时从 initialView 起步,逐条 applyView 重建任意时刻的 GameView。
//
// debug 模式录制所有座次 → 回放支持视角切换;
// 多人模式只录当前座次 → 回放仅当前视角。

import type { GameView, ViewEvent } from '../../engine/types';

export const REPLAY_FORMAT = 'sanguosha-replay' as const;
export const REPLAY_VERSION = 1;

export interface ReplayMeta {
  createdAt: number;
  playerCount: number;
  /** 按座次顺序的武将名(选将完成后填充) */
  characters: string[];
  roomName?: string;
}

/** 单座次录像:独立的事件流 */
export interface SeatRecording {
  seatIndex: number;
  playerName: string;
  /** 游戏开始后第一个完整 GameView 的深拷贝(JSON 可序列化,作为回放起点) */
  initialView: GameView;
  /** 该座次收到的 ViewEvent 序列(逐 atom,seq 升序) */
  events: Array<{ seq: number; time: number; event: ViewEvent }>;
}

export interface ReplayFile {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_VERSION;
  meta: ReplayMeta;
  /** 座次下标 → 录像。debug 模式含全部座次;多人模式只含当前座次 */
  seats: Record<number, SeatRecording>;
}
