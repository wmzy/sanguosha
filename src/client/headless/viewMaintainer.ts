// src/client/headless/viewMaintainer.ts
// 把 useDebugMultiConnection.handleMessage 中 view/lastSeq/pending/deadline/phase 的
// 纯逻辑剥离。输入当前快照 + ServerMessage，输出更新后快照。无 WS/React。
import { viewReducer } from '../view/reducer';
import type { GameView, ViewEvent } from '../../engine/types';
import type { ServerMessage, RoomConfig } from '../../server/protocol';
import type { ClientPhase, RoomState } from './types';
import { shouldClearPending, syncDeadline, cloneViewForMutation } from '../utils/viewMaintenance';

export interface ViewSnapshot {
  view: GameView | null;
  lastSeq: number;
  playerId?: string;
  roomId?: string;
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
    view: prev,
    lastSeq: prevSeq,
    newEvents: [],
    phaseChangedTo: null,
  };
  switch (msg.type) {
    case 'initialView': {
      const view = msg.state;
      return {
        ...base,
        view,
        lastSeq: msg.lastSeq,
        seatIndex: view.viewer,
        phaseChangedTo: 'playing',
      };
    }
    case 'event': {
      if (!prev) return base;
      // seq 去重:重连/EventSource 自动重连/HMR 等场景下,服务端可能重放已处理过的 event
      // (seq<=prevSeq)。viewReducer 的 applyView 会原地突变(hand/marks/processing 等 push),
      // 重复应用会让手牌等数组累积重复。initialView 已是全量基线,后续 event 应 seq>lastSeq
      // 单调递增;过时/重复 event 整条丢弃(notify/deadline 亦如此——最新状态由更高 seq 决定)。
      if (msg.seq <= prevSeq) return base;
      let view = prev;
      const newEvents: ViewEvent[] = [];
      if (msg.notify) {
        if (msg.notify.eventType === 'pendingResolved') {
          const target = (msg.notify.data as { target?: number }).target;
          if (target !== undefined && shouldClearPending(view.pending, target, view.viewer)) {
            view = { ...view, pending: null };
            syncDeadline(view, null);
          }
        }
      }
      if (msg.view) {
        // viewReducer 原地突变；复制一份避免污染外部引用(含 memo 冻结规避,
        // 覆盖字段与理由见 cloneViewForMutation 的 doc comment)。
        view = cloneViewForMutation(view);
        viewReducer(view, msg.view, msg.timestamp);
        newEvents.push(msg.view);
      }
      if (msg.deadline !== undefined) {
        if (msg.deadline !== null && view.pending) {
          view = {
            ...view,
            pending: {
              ...view.pending,
              deadline: msg.deadline.deadline,
              totalMs: msg.deadline.totalMs,
            },
          };
        }
        view = { ...view };
        syncDeadline(view, msg.deadline);
      }
      if (msg.pending !== undefined) {
        view = { ...view, pending: msg.pending };
        syncDeadline(view, msg.pending);
      }
      return { ...base, view, lastSeq: msg.seq, newEvents };
    }
    case 'gameOver':
      return { ...base, phaseChangedTo: 'ended', gameOverWinner: msg.winner };
    case 'game_reset':
      return { ...base, view: null, lastSeq: 0, resetToLobby: true, phaseChangedTo: 'lobby' };
    case 'room_joined':
      return {
        ...base,
        playerId: msg.playerId,
        roomId: msg.roomId,
        seatIndex: typeof msg.seatIndex === 'number' ? msg.seatIndex : base.seatIndex,
      };
    case 'room_state':
      return {
        ...base,
        roomState: {
          readyPlayers: msg.readyPlayers,
          playerIds: msg.playerIds,
          hostId: msg.hostId,
          maxPlayers: msg.maxPlayers,
          config: msg.config,
          spectatorIds: msg.spectatorIds ?? [],
          viewGrants: msg.viewGrants ?? {},
          pendingViewRequests: msg.pendingViewRequests ?? {},
          roomType: msg.roomType,
          seats: msg.seats ?? [],
          pendingSeatSwaps: msg.pendingSeatSwaps ?? {},
          playerNames: msg.playerNames ?? {},
        },
      };
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
export function mergeRoomConfig(prev: RoomState | null, config: RoomConfig): RoomState | null {
  return prev ? { ...prev, config } : prev;
}
