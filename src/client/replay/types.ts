// src/client/replay/types.ts
// 录像格式定义(v2:baseline + delta)。
//
// 核心思想:多座次录像是「一份公共对局 + N 个视角的私有差异」。
// v1 把每个座次的完整 initialView + events 各存一份,造成大量重复
// (cardMap 跨座次完全相同,占文件 64%;events 跨座次 ~89% 相同)。
//
// v2 拆分:
//   baseline  —— 跨所有座次共享的 GameView 公共部分(cardMap/log/turn/公开玩家信息…),存一份
//   seats[]   —— 每座次只存私有差异(viewer 自己的手牌 + 身份可见性 + 事件流)
//
// 录制器(ReplayRecorder)内部仍逐座次收集完整 initialView,在 finalize 时
// 提取公共 baseline + 计算每座次 delta,录制逻辑零改动。

import type { Card, GameView, ViewEvent } from '../../engine/types';

export const REPLAY_FORMAT = 'sanguosha-replay' as const;
export const REPLAY_VERSION = 2;

export interface ReplayMeta {
  createdAt: number;
  playerCount: number;
  /** 按座次顺序的武将名(选将完成后填充) */
  characters: string[];
  roomName?: string;
}

/** GameView.players 元素类型 */
type PlayerView = GameView['players'][number];

/** 公开玩家信息:跨座次相同的部分(剥离 viewer-dependent 的 hand/identity/identityHidden)。
 *  用 Omit 派生,自动跟随 GameView 变化,无需重复维护字段。 */
export type PublicPlayerView = Omit<PlayerView, 'hand' | 'identity' | 'identityHidden'>;

/** 录像 baseline:跨所有座次共享的 GameView 公共部分。
 *  公共字段用 Pick 从 GameView 派生;players 替换为去私有字段的 PublicPlayerView。 */
export interface ReplayBaseline extends
  Pick<GameView,
    'cardMap' | 'log' | 'turn' | 'phase' | 'currentPlayerIndex' |
    'zones' | 'settlementStack' | 'pending' | 'deadline' | 'deadlineTotalMs'
  > {
  players: PublicPlayerView[];
}

/** 单座次事件条目(去掉冗余 seq——数组下标即序号) */
export interface ReplayEvent {
  time: number;
  event: ViewEvent;
}

/** 单座次私有差异:与 baseline 的不同部分。
 *  回放时 reconstructInitialView(baseline, delta) 合并出完整 GameView。 */
export interface SeatDelta {
  /** 该 viewer 的座次下标 */
  viewer: number;
  playerName: string;
  /** 该 viewer 能看到手牌的玩家(通常只有自己)。
   *  死亡弃牌/反间/攻心等场景下可能为空或多个。 */
  privateHands: Array<{ index: number; hand: Card[] }>;
  /** 该 viewer 视角下各玩家的身份可见性。
   *  baseline 不含身份(主公身份公开规则由各座次视角决定),每座次独立存。 */
  identityView: Array<{ index: number; identity?: string; identityHidden?: boolean }>;
  /** 该座次收到的 ViewEvent 序列(数组下标即 seq) */
  events: ReplayEvent[];
}

export interface ReplayFile {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_VERSION;
  meta: ReplayMeta;
  baseline: ReplayBaseline;
  /** 座次下标 → 私有差异。debug 模式含全部座次;多人模式只含当前座次 */
  seats: Record<number, SeatDelta>;
}
