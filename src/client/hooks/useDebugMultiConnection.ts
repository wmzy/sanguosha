// src/client/hooks/useDebugMultiConnection.ts
// Debug 多座次连接管理 hook。
//
// 重构后基于 HeadlessGameClient：每个座次一个 HGC 实例，hook 退化为协调器。
// StrictMode 安全：effect 管理自己的连接生命周期。
//
// 单活流模型(2026-08):
//   每个座次的 HGC 都会 join(REST),但只有「当前视角」座次持有 SSE 长连。
//   原因:浏览器对同源 HTTP/1.1 并发连接上限 6,N 条长连 SSE 会饿死页面上的
//   图片/REST 请求(头像/卡牌加载不出、ready/action POST 排队挂起)。
//   视角切换时挂起旧流、恢复新流,服务端按新连接回 initialView 全量快照。

import { useState, useEffect, useRef, useCallback } from 'react';
import { HeadlessGameClient } from '../headless/HeadlessGameClient';
import type { ClientPhase } from '../headless/types';
import { useEventPlayback } from './useEventPlayback';
import { useMarkCharSelectSubmitted, useClearSubmittedCharSelects } from './useSubmittedCharSelect';
import { createLogger } from '../utils/logger';
import { logWsMessage, logUserAction } from '../utils/debugTelemetry';
import { useAuth } from './useAuth';
import { isRoomNotFound } from '../utils/roomErrors';
import type { GameView } from '../../engine/types';
import { suitColor, type Suit } from '../../engine/types';
import type { ServerMessage, ClientMessage } from '../../server/protocol';
import type { ActionMsg } from '../types';
import { appendIngestedEvents } from '../utils/appendIngestedEvents';

const log = createLogger('useDebugMultiConnection');

/** 判定牌在处理区停留时间(ms),供玩家看清花色点数后移除 */
const JUDGE_CARD_LINGER_MS = 2500;

export type { ActionMsg };

export interface UseDebugMultiConnectionParams {
  roomId: string;
  playerCount: number;
  perspective: number;
  onFirstView?: (viewer: number) => void;
  /** 座次连接失败(如房间被服务端回收后 join 404)。触发一次后由调用方决定退路。 */
  onConnectError?: (err: unknown) => void;
}

/** 房间准备状态(配置阶段)。由 room_state 消息驱动更新。 */
export interface RoomState {
  readyPlayers: string[];
  playerIds: string[];
  hostId: string | null;
  maxPlayers: number;
  config: import('../../server/protocol').RoomConfig;
}

export function useDebugMultiConnection(params: UseDebugMultiConnectionParams): {
  views: Map<number, GameView>;
  currentEvent: import('./useEventPlayback').QueuedEvent | null;
  /** 刚入队的事件批次:出牌历史条立即消费(不等播放队列) */
  ingestedEvents: import('./useEventPlayback').QueuedEvent[];
  /** 待播事件队列积压数(>1 时 GameView 横幅显示「+N 排队中」角标) */
  pendingCount: number;
  /** 一键清空事件播放积压(横幅角标 ⏭,立即对齐到最新事件) */
  skipEvents: () => void;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
  disconnectAll: () => void;
  getSeq: (seat: number) => number;
  /** 配置阶段:房间准备状态 */
  roomState: RoomState | null;
  /** 配置阶段:游戏是否已开始 */
  gameStarted: boolean;
  /** 游戏结束结果(null=进行中);收到后触发结算界面 */
  gameOver: { winner: string } | null;
  /** 配置阶段:座次→playerId 映射 */
  seatPlayerIds: Map<number, string>;
  /** 配置阶段:指定座次发送准备 */
  sendReady: (seat: number) => void;
  /** 配置阶段:指定座次取消准备 */
  sendCancelReady: (seat: number) => void;
  /** 配置阶段:发送开始游戏(任意座次连接) */
  sendStartGame: () => void;
  /** 发送重新开始游戏(再来一局) */
  sendRestart: () => void;
  /** 配置阶段:更新房间配置 */
  sendUpdateConfig: (config: import('../../server/protocol').RoomConfig) => void;
  /** 已连接座次数 */
  connectedCount: number;
  /** 正在重连的座次数(0=全部已连接) */
  reconnectingCount: number;
  /** 座次连接失败原因(房间不存在/网络错误等;null=无)。触发 onConnectError 时同步设置。 */
  connectError: string | null;
} {
  const { roomId, playerCount, perspective } = params;
  // viewer index → HGC 实例(key=join 请求序号,仅作生命周期管理)
  const clientsRef = useRef<Map<number, HeadlessGameClient>>(new Map());
  // 真实座次 → HGC(join 完成后按服务端返回的 seatIndex 注册)。
  // 服务端按 join 到达顺序分配座次,请求序号 ≠ 真实座次;单活流的挂起/恢复
  // 必须按真实座次查找,否则恢复的是另一座次的连接,快照 viewer 与 perspective
  // 错位,UI 永远停在「正在连接」。
  const clientsByViewerRef = useRef<Map<number, HeadlessGameClient>>(new Map());
  /** 自愈计数:视图缺失超时后 +1 触发连接全量重建(等价刷新页面)。 */
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [views, setViews] = useState<Map<number, GameView>>(new Map());
  const [connectedCount, setConnectedCount] = useState(0);
  const [reconnectingCount, setReconnectingCount] = useState(0);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  /** gameStarted 的 ref 镜像:connect().then 回调读取实时值。effect 运行时捕获的
   *  闭包值在「开局瞬间仍有在途 join」场景下是过期的 false,会导致单活流对齐被
   *  跳过(对齐兜底在 [perspective] effect 的 gameStarted 依赖,但能当场对齐更好)。 */
  const gameStartedRef = useRef(false);
  useEffect(() => {
    gameStartedRef.current = gameStarted;
  }, [gameStarted]);
  /** 游戏结束结果(winner=胜方座次号字符串,或 '无人')。收到 gameOver 消息后设置。 */
  const [gameOver, setGameOver] = useState<{ winner: string } | null>(null);
  const [seatPlayerIds, setSeatPlayerIds] = useState<Map<number, string>>(new Map());
  const playback = useEventPlayback();
  const playbackRef = useRef(playback);
  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);
  /** 出牌历史:由 onView.newEvents 驱动(与播放队列解耦,使用时立即入条) */
  const [ingestedEvents, setIngestedEvents] = useState<
    import('./useEventPlayback').QueuedEvent[]
  >([]);
  const historySeqRef = useRef(0);
  const perspectiveRef = useRef(perspective);
  useEffect(() => {
    perspectiveRef.current = perspective;
  }, [perspective]);
  const onFirstViewRef = useRef(params.onFirstView);
  useEffect(() => {
    onFirstViewRef.current = params.onFirstView;
  }, [params.onFirstView]);
  const onConnectErrorRef = useRef(params.onConnectError);
  useEffect(() => {
    onConnectErrorRef.current = params.onConnectError;
  }, [params.onConnectError]);
  /** 连接失败提示(多座次只报第一条;null=无) */
  const [connectError, setConnectError] = useState<string | null>(null);
  const connectErrorFiredRef = useRef(false);
  const markSubmitted = useMarkCharSelectSubmitted();
  const clearSubmitted = useClearSubmittedCharSelects();
  /** HGC 首次收到 initialView 的座次集合，用于触发 onFirstView（仅 viewer=0 一次） */
  const firstViewFiredRef = useRef(false);
  /** 登录用户 id:调试座次 playerId 的基础名(RequireAuth 门禁保证非空) */
  const authUser = useAuth().user;
  const authUserId = authUser?.id ?? null;

  const serverUrl = window.location.origin;

  /** 查找某 viewer 对应的 HGC（viewer 字段可能被 room_joined.seatIndex 覆盖，故按 viewer 遍历） */
  const clientByViewer = useCallback((viewer: number): HeadlessGameClient | undefined => {
    return [...clientsRef.current.values()].find((c) => c.seatIndex === viewer);
  }, []);

  // ── 建立连接：N 个 HGC 实例 ──
  useEffect(() => {
    if (!roomId || playerCount < 2) return;
    // auth 未就绪(/me 探测中)不建连:本 hook 内的 useAuth 是独立实例,其 /me 晚于
    // 组件挂载返回。若此时以 baseId='debug' 建连,authUserId 就绪后 effect 重跑,
    // 旧连接 SSE 断开会触发服务端 leaveRoom → quick 房「全员离开自动销毁」,
    // 新一波 join 撞上已删房间 404 → onRoomGone 被踢回大厅(偶现,网络时序决定)。
    // 等就绪后一次性建连,永远只有一波连接。
    if (authUserId === null) return;
    clientsRef.current.clear();
    clientsByViewerRef.current.clear();
    setViews(new Map());
    playbackRef.current.reset(0);
    setConnectedCount(0);
    setReconnectingCount(0);
    setGameOver(null);
    setSeatPlayerIds(new Map());
    firstViewFiredRef.current = false;
    connectErrorFiredRef.current = false;
    setConnectError(null);

    // StrictMode 安全：cleanup 后不再 join，避免幽灵连接占用座次
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    // 只在 connect() join 成功后递增(closed-over 计数器,StrictMode cleanup 后不再加)
    let connectionOpenCount = 0;

    // 各座次派生独立 playerId(身份#座次),保证服务端按不同玩家入座。
    // 调试房保持游客模型:基础名取登录用户 id(RequireAuth 保证已登录),座次加 # 后缀。
    const baseId = authUserId ?? 'debug';

    /* eslint-disable no-loop-func -- 回调安全捕获 effect 作用域的 cancelled/connectionOpenCount 标志,cleanup 后才置 true */
    for (let i = 0; i < playerCount; i++) {
      const viewerIndex = i;
      const hgc = new HeadlessGameClient(serverUrl, {
        onView: (view, newEvents) => {
          if (cancelled) return;
          setViews((prev) => {
            const next = new Map(prev);
            next.set(view.viewer, view);
            return next;
          });
          // 出牌历史:追加批次(不可替换——WS 连发时 React 会合并 setState 丢掉中间的打出)
          if (newEvents.length > 0 && view.viewer === perspectiveRef.current) {
            setIngestedEvents((prev) =>
              appendIngestedEvents(prev, newEvents, () => ++historySeqRef.current),
            );
          }
          if (!firstViewFiredRef.current && view.viewer === 0) {
            firstViewFiredRef.current = true;
            onFirstViewRef.current?.(view.viewer);
          }
        },
        onPhaseChange: (phase: ClientPhase) => {
          if (cancelled) return;
          if (phase === 'playing') setGameStarted(true);
          // connectedCount 改按 join 成功计数(见 connect().then),不再依赖每座次 SSE open
        },
        onGameOver: (winner: string) => {
          if (cancelled) return;
          setGameOver({ winner });
        },
        onRoomState: (state) => {
          if (cancelled || !state) return;
          setRoomState(state);
        },
        onError: () => {
          /* WS error 已由重连机制覆盖 */
        },
        onReconnectStateChange: (state) => {
          if (cancelled) return;
          setReconnectingCount((prev) => {
            if (state === 'reconnecting') return prev + 1;
            if (state === 'idle' && prev > 0) return prev - 1;
            return prev;
          });
        },
        onMessage: (msg: ServerMessage) => {
          if (cancelled) return;
          logWsMessage(viewerIndex, 'in', msg);
          handleDisplayMessage(viewerIndex, msg);
        },
      });
      clientsRef.current.set(viewerIndex, hgc);
      // connect 是 async:房间被服务端回收后 join 404 会 throw。
      // 必须 catch,否则 unhandled rejection 且 UI 永远停在「0/N 已连接」。
      hgc.connect(roomId, viewerIndex, baseId ? `${baseId}#${viewerIndex}` : undefined, {
        stream: viewerIndex === perspectiveRef.current,
      })
        .then(() => {
          if (cancelled) return;
          // join 成功即计入「已连接」(单活流模式下不再依赖每座次 SSE open 计数)
          connectionOpenCount++;
          setConnectedCount(connectionOpenCount);
          const joinedId = hgc.playerId;
          if (joinedId) {
            setSeatPlayerIds((prev) => {
              const next = new Map(prev);
              next.set(viewerIndex, joinedId);
              return next;
            });
          }
          // 按服务端分配的真实座次注册(可能与请求序号不同)
          const trueSeat = hgc.seatIndex;
          if (trueSeat >= 0) clientsByViewerRef.current.set(trueSeat, hgc);
          // 连接完成时的单活流决策:真实座次是当前视角才持流,其余挂起并废弃视图。
          // 仅对局中生效(读 ref 实时值,避免 effect 闭包的过期 false):大厅期
          // (room.status='等待中')非当前视角座次连接时本就 stream:false 无流,
          // 而挂起当前唯一持流座次会让服务端 SSE onAbort 走 leaveRoom,清掉该座次
          // 的成员资格与 readyPlayers(表现:配置面板「已准备」静默弹回)。
          // 开局瞬间仍在途的 join 由 [perspective] effect 的 gameStarted 依赖兜底对齐。
          if (gameStartedRef.current) {
            if (trueSeat === perspectiveRef.current) {
              hgc.resumeStream();
            } else if (trueSeat >= 0) {
              hgc.suspendStream();
              setViews((prev) => {
                if (!prev.has(trueSeat)) return prev;
                const next = new Map(prev);
                next.delete(trueSeat);
                return next;
              });
            }
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message = isRoomNotFound(err)
            ? '房间已不存在或已关闭'
            : err instanceof Error
              ? err.message
              : String(err);
          log.error('connect failed', { roomId, viewer: viewerIndex, error: message });
          // 多座次并发失败只上报一次(其余座次多为同一原因)
          if (connectErrorFiredRef.current) return;
          connectErrorFiredRef.current = true;
          setConnectError(message);
          onConnectErrorRef.current?.(err);
        },
      );
      cleanups.push(() => {
        try {
          hgc.disconnect();
        } catch {
          /* */
        }
      });
    }
    /* eslint-enable no-loop-func */

    return () => {
      cancelled = true;
      for (const c of cleanups) c();
      clearSubmitted();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, playerCount, serverUrl, authUserId, reconnectNonce]);

  // ── 单活流调度:视角切换时挂起旧座次流、恢复新座次流 ──
  // 浏览器对同源 HTTP/1.1 并发连接有 6 条上限,N 座次长连 SSE 会饿死页面上的
  // 图片/REST 请求(表现为头像/卡牌加载不出、ready/action POST 排队挂起)。
  // 因此任意时刻只保留当前视角一条 SSE;其余座次的 HGC 仅作 REST 驱动。
  // 切回时 resumeStream() 由服务端按新连接回 initialView 全量快照,视图自动对齐。
  // 挂起座次的缓存视图必须同时废弃:它是过时快照,既不能作为渲染依据(短暂闪现
  // 错误提示/按钮),也会误导 useDebugPerspective 的自动跟随(看见已不存在的 pending)。
  // 仅对局中生效:大厅期(room.status='等待中')非当前视角座次本来就没有流
  // (connect 传 stream:false),而挂起唯一持流座次(配置面板依赖它的 room_state
  // 推送)会触发服务端 SSE onAbort → leaveRoom,清掉该座次的 seats/readyPlayers,
  // 表现为「已准备」点完几秒内静默弹回。gameStarted 作为依赖:开局广播到达、
  // phase 翻转为 playing 时本 effect 重跑,补齐「开局→翻转」窗口期切过视角而
  // 错过的调度;game_reset 回大厅后自动停用(回到大厅期不变式:仅持流座次有流)。
  useEffect(() => {
    if (!gameStarted) return;
    for (const [seat, hgc] of clientsByViewerRef.current) {
      try {
        if (seat === perspective) {
          hgc.resumeStream();
        } else {
          hgc.suspendStream();
          setViews((prev) => {
            if (!prev.has(seat)) return prev;
            const next = new Map(prev);
            next.delete(seat);
            return next;
          });
        }
      } catch {
        /* 已 disconnect 的实例:忽略 */
      }
    }
  }, [perspective, gameStarted]);

  // ── 自愈:当前视角缺视图超过阈值时全量重连 ──
  // 单活流下切视角依赖「挂起旧流→恢复新流→快照重建」。若快照丢失或重连后
  // 服务端座次分配与客户端映射漂移,UI 会停在「正在连接」。此处等价于刷新
  // 页面:teardown 全部连接后按同一 roomId 重新 join(服务端按 playerId 归还
  // 原座次),重建单活流。刷新页面始终能恢复,故此路径语义最稳。
  // 仅对局开始后生效:配置阶段本就无任何视图,不设防会每 3s 全量重连,
  // 服务端断连清理会把 readyPlayers 一并清掉(表现:准备按钮点完几秒内全部弹回)。
  useEffect(() => {
    if (!gameStarted) return;
    if (views.has(perspective)) return;
    // 座次连接尚在建立(joins 未全部完成)时不判定失速,避免自愈与建连互相打断
    if (connectedCount < playerCount) return;
    const timer = setTimeout(() => {
      log.info('视角视图缺失,全量重连自愈', { perspective });
      setViews(new Map());
      setReconnectNonce((n) => n + 1);
    }, 3000);
    return () => clearTimeout(timer);
  }, [gameStarted, views, perspective, connectedCount, playerCount]);

  /** 展示层消息增强：seatPlayerIds/game_reset/判定牌 processing 延迟/event playback。
   *  HGC 已维护 view；这里只做渲染相关的额外处理。 */
  const handleDisplayMessage = useCallback(
    (viewerIndex: number, msg: ServerMessage) => {
      switch (msg.type) {
        case 'room_joined': {
          // 与原始 hook 一致：用 viewerIndex（循环索引）而非 msg.seatIndex 做 key
          setSeatPlayerIds((prev) => {
            const next = new Map(prev);
            next.set(viewerIndex, msg.playerId);
            return next;
          });
          // room_joined 可能修正 seatIndex(与服务端分配对齐),按真实座次补登记。
          // 对局中挂起旧流 → 服务端 clearDebugPlayer 删座次映射;恢复时 assignDebugSeat
          // 按「最小空闲座次」重排,同一 HGC 可能拿到新座号。必须先删它占着的旧键再
          // 注册新键:否则同一 HGC 在 map 中占双键,而被顶掉座次的键指向失联实例,
          // 单活流调度/按座次查找全部错位(座次漂移,UI 卡「正在连接」直到 3s 全量
          // 重连自愈)。被顶掉座次的旧值由本次 set 直接覆盖,该 HGC 下次恢复拿到
          // 自己的 room_joined 时再补登记。
          const joinedHgc = clientsRef.current.get(viewerIndex);
          if (joinedHgc && joinedHgc.seatIndex >= 0) {
            const newSeat = joinedHgc.seatIndex;
            for (const [seat, hgc] of clientsByViewerRef.current) {
              if (hgc === joinedHgc && seat !== newSeat) {
                clientsByViewerRef.current.delete(seat);
              }
            }
            clientsByViewerRef.current.set(newSeat, joinedHgc);
          }
          break;
        }
        case 'game_reset': {
          setGameOver(null);
          setGameStarted(false);
          for (const [, c] of clientsRef.current) {
            /* HGC 内部已重置 view */ void c;
          }
          setViews(new Map());
          clearSubmitted();
          break;
        }
        case 'event': {
          // 以 HGC 的真实座次为权威键:循环下标 ≠ 服务端座次(并发 join 按到达顺序
          // 入座,对局中挂起/恢复还会重排座号),而 views(onView 按 view.viewer 写入)
          // 与 perspective(开局后 onFirstView/useDebugPerspective 均为真实座次)都在
          // 真实座次空间——用循环下标会读错视图键、漏播当前视角的事件。
          const seat = clientsRef.current.get(viewerIndex)?.seatIndex ?? viewerIndex;
          // event playback / 出牌历史:仅当前视角连接的事件入队,避免 N 座次重复入队
          if (msg.view && seat === perspectiveRef.current) {
            playbackRef.current.enqueue([{ seq: msg.seq, event: msg.view }]);
          }
          // 判定牌 processing 延迟展示：判定牌加入 processing 几秒后移除
          if (msg.view && (msg.view.atomType ?? msg.view.type) === '判定') {
            const judgeCardId = msg.view.cardId as string | undefined;
            const judgeCard = msg.view.card as
              | { name: string; suit: string; rank: string }
              | undefined;
            if (judgeCardId) {
              setViews((prev) => {
                const v = prev.get(seat);
                if (!v) return prev;
                if (!v.cardMap[judgeCardId] && judgeCard) {
                  v.cardMap[judgeCardId] = {
                    id: judgeCardId,
                    name: judgeCard.name,
                    suit: judgeCard.suit as GameView['cardMap'][string]['suit'],
                    color: suitColor(judgeCard.suit as Suit),
                    rank: judgeCard.rank,
                    type: '基本牌',
                  };
                }
                if (v.zones && !v.zones.processing.includes(judgeCardId)) {
                  v.zones.processing.push(judgeCardId);
                }
                return new Map(prev).set(seat, v);
              });
              setTimeout(() => {
                setViews((prev) => {
                  const v = prev.get(seat);
                  if (!v?.zones) return prev;
                  const idx = v.zones.processing.indexOf(judgeCardId);
                  if (idx < 0) return prev;
                  v.zones.processing.splice(idx, 1);
                  return new Map(prev).set(seat, v);
                });
              }, JUDGE_CARD_LINGER_MS);
            }
          }
          break;
        }
        default:
          break;
      }
    },
    [clearSubmitted],
  );

  /** 发送 action：走 ownerId 对应 viewer 的连接 */
  const sendAction = useCallback(
    (action: ActionMsg) => {
      const hgc = clientByViewer(action.ownerId);
      if (!hgc) {
        log.warn('no connection for viewer', action.ownerId);
        return;
      }
      // 选将 action 发出时标记该座次已提交，乐观清除 view.pending
      if (action.actionType === '选将') {
        markSubmitted(action.ownerId);
        setViews((prev) => {
          const seatView = prev.get(action.ownerId);
          if (!seatView?.pending) return prev;
          const next = new Map(prev);
          next.set(action.ownerId, { ...seatView, pending: null });
          return next;
        });
      }
      const clientMsg: ClientMessage = {
        type: 'action',
        action: { ...action, baseSeq: hgc.lastSeq },
        baseSeq: hgc.lastSeq,
      };
      logWsMessage(action.ownerId, 'out', clientMsg);
      logUserAction('action', action);
      // HGC.sendAction 会补 pendingSeq + baseSeq
      hgc.sendAction(action as import('../../engine/types').ClientMessage);
    },
    [clientByViewer, markSubmitted],
  );

  /** 整理手牌：走当前 perspective viewer 的连接 */
  const reorderHand = useCallback(
    (order: string[]) => {
      const hgc = clientByViewer(perspectiveRef.current);
      if (!hgc) return;
      const clientMsg: ClientMessage = { type: 'reorder_hand', order };
      logWsMessage(perspectiveRef.current, 'out', clientMsg);
      logUserAction('reorder', order);
      hgc.reorderHand(order);
    },
    [clientByViewer],
  );

  const disconnectAll = useCallback(() => {
    for (const [, hgc] of clientsRef.current) {
      try {
        hgc.disconnect();
      } catch {
        /* */
      }
    }
    clientsRef.current.clear();
    clientsByViewerRef.current.clear();
    setViews(new Map());
    setConnectedCount(0);
    setReconnectingCount(0);
    setRoomState(null);
    setGameStarted(false);
    setSeatPlayerIds(new Map());
  }, []);

  const getSeq = useCallback(
    (viewer: number): number => {
      return clientByViewer(viewer)?.lastSeq ?? 0;
    },
    [clientByViewer],
  );

  // ── 配置阶段方法 ──
  const sendReady = useCallback((seat: number) => {
    const hgc = clientsRef.current.get(seat);
    if (!hgc) return;
    const msg: ClientMessage = { type: 'ready' };
    logWsMessage(seat, 'out', msg);
    logUserAction('ready', seat);
    hgc.sendReady();
  }, []);

  const sendCancelReady = useCallback((seat: number) => {
    const hgc = clientsRef.current.get(seat);
    if (!hgc) return;
    logWsMessage(seat, 'out', { type: 'cancel-ready' });
    logUserAction('cancel_ready', seat);
    hgc.sendCancelReady();
  }, []);

  const sendStartGame = useCallback(() => {
    const hgc = clientsRef.current.get(0);
    if (!hgc) return;
    const msg: ClientMessage = { type: 'start_game' };
    logWsMessage(0, 'out', msg);
    logUserAction('start_game', null);
    hgc.sendStartGame();
  }, []);

  const sendRestart = useCallback(() => {
    const hgc = clientsRef.current.get(0);
    if (!hgc) return;
    const msg: ClientMessage = { type: 'restart_game' };
    logWsMessage(0, 'out', msg);
    logUserAction('restart_game', null);
    hgc.sendRestart();
  }, []);

  const sendUpdateConfig = useCallback((config: import('../../server/protocol').RoomConfig) => {
    const hgc = clientsRef.current.get(0);
    if (!hgc) return;
    const msg: ClientMessage = { type: 'update_room_config', config };
    logWsMessage(0, 'out', msg);
    logUserAction('update_config', config);
    hgc.sendUpdateConfig(config);
  }, []);

  return {
    views,
    currentEvent: playback.current,
    ingestedEvents,
    pendingCount: playback.pendingCount,
    skipEvents: playback.skipAll,
    sendAction,
    reorderHand,
    disconnectAll,
    getSeq,
    roomState,
    gameStarted,
    gameOver,
    seatPlayerIds,
    sendReady,
    sendCancelReady,
    sendStartGame,
    sendRestart,
    sendUpdateConfig,
    connectedCount,
    reconnectingCount,
    connectError,
  };
}
