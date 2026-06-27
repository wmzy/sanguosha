// src/client/headless/viewMaintainer.ts
// 把 useDebugMultiConnection.handleMessage 中 view/lastSeq/pending/deadline/phase 的
// 纯逻辑剥离。输入当前快照 + ServerMessage，输出更新后快照。无 WS/React。
import { viewReducer } from '../view/reducer';
import type { GameView, ViewEvent } from '../../engine/types';
import type { ServerMessage, RoomConfig } from '../../server/protocol';
import type { ClientPhase, RoomState } from './types';

export interface ViewSnapshot {
  view: GameView | null;
  lastSeq: number;
  playerId?: string;
  seatIndex?: number;
}

export interface ApplyResult extends ViewSnapshot {
  /** 本次产生的新事件（view 分支）；notify/event 无 view 时为空 */
  newEvents: ViewEvent[];
  /** phase 是否切换，及切到哪个 */
  phaseChangedTo: ClientPhase | null;
  /** gameOver 时的胜方；仅 type=gameOver 时有值 */
  gameOverWinner?: string;
  /** room_state 类消息的 RoomState（由调用方透传给 onRoomState） */
  roomState?: RoomState | null;
  /** 是否被 rejected */
  actionRejected?: boolean;
  /** 是否需要清空 view 回到 lobby（game_reset） */
  resetToLobby?: boolean;
}

export function applyServerMessage(
  prev: GameView | null,
  prevSeq: number,
  msg: ServerMessage,
): ApplyResult {
  const base: ApplyResult = {
    view: prev, lastSeq: prevSeq, newEvents: [], phaseChangedTo: null,
  };
  switch (msg.type) {
    case 'initialView': {
      const view = msg.state;
      return { ...base, view, lastSeq: msg.lastSeq, seatIndex: view.viewer, phaseChangedTo: 'playing' };
    }
    case 'event': {
      if (!prev) return base;
      let view = prev;
      const newEvents: ViewEvent[] = [];
      if (msg.notify) {
        if (msg.notify.eventType === 'pendingResolved') {
          const target = (msg.notify.data as { target?: number }).target;
          if (target !== undefined && (target === view.viewer || target < 0) && view.pending) {
            view = { ...view, pending: null };
          }
        }
      }
      if (msg.view) {
        // viewReducer 原地突变；复制一份避免污染外部引用
        view = { ...view };
        viewReducer(view, msg.view, msg.timestamp);
        newEvents.push(msg.view);
      }
      if (msg.deadline !== undefined) {
        if (msg.deadline !== null && view.pending) {
          view = {
            ...view,
            pending: { ...view.pending, deadline: msg.deadline.deadline, totalMs: msg.deadline.totalMs },
          };
        }
        view = {
          ...view,
          deadline: msg.deadline !== null ? msg.deadline.deadline : null,
          deadlineTotalMs: msg.deadline !== null ? msg.deadline.totalMs : 0,
        };
      }
      return { ...base, view, lastSeq: msg.seq, newEvents };
    }
    case 'gameOver':
      return { ...base, phaseChangedTo: 'ended', gameOverWinner: msg.winner };
    case 'game_reset':
      return { ...base, view: null, lastSeq: 0, resetToLobby: true, phaseChangedTo: 'lobby' };
    case 'room_joined':
      return { ...base, playerId: msg.playerId, seatIndex: typeof msg.seatIndex === 'number' ? msg.seatIndex : base.seatIndex };
    case 'room_state':
      return { ...base, roomState: { readyPlayers: msg.readyPlayers, playerIds: msg.playerIds, hostId: msg.hostId, maxPlayers: msg.maxPlayers, config: msg.config } };
    case 'room_config':
      return { ...base }; // 由调用方合并到现有 roomState
    case 'player_ready':
      return { ...base }; // 增量由 room_state 权威覆盖
    case 'game_started':
      return { ...base, phaseChangedTo: 'playing' };
    case 'actionRejected':
      return { ...base, actionRejected: true };
    default:
      return base;
  }
}

/** 合并 room_config 增量到现有 roomState。viewMaintainer 不持有 roomState，供 HeadlessGameClient 用。 */
export function mergeRoomConfig(
  prev: RoomState | null,
  config: RoomConfig,
): RoomState | null {
  return prev ? { ...prev, config } : prev;
}
