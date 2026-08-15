// src/client/hooks/useEventPlayback.ts
// 事件播放 hook:ViewEvent 按 seq 入队。结构事件(回合/阶段)只响音效+进历史条,
// 不进横幅队列;牌操作事件进中央横幅逐个展示,duration 到点出队。
// ingested(每批新鲜事件)独立于横幅队列,供音效/历史条/飞牌动画立即消费。
//
// 非阻塞语义:横幅 pointer-events:none,本 hook 只负责时序调度,不拦截交互。
//
// 过时事件处理:新批次 seq <= 已处理最大值时丢弃。

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ViewEvent } from '../../engine/types';
import { getAtomDef } from '../../engine/core/atom';

/** 事件动效播放速度档位(localStorage 持久化) */
export type AnimSpeed = 'normal' | 'fast';

/** 速度档位存储 key */
const ANIM_SPEED_KEY = 'sgs_anim_speed';

/** 读取速度档位;无效/缺失值回退 'normal'(localStorage 抛异常如隐私模式也回退) */
export function getAnimSpeed(): AnimSpeed {
  try {
    return localStorage.getItem(ANIM_SPEED_KEY) === 'fast' ? 'fast' : 'normal';
  } catch {
    return 'normal';
  }
}

/** 写入速度档位(持久化,刷新后保持) */
export function setAnimSpeed(s: AnimSpeed): void {
  try {
    localStorage.setItem(ANIM_SPEED_KEY, s);
  } catch {
    // 写入失败(隐私模式/存储满)静默忽略:本次会话内仍可经 state 生效
  }
}

/** 最小可见时长(ms),保证事件能被看清,即便 effect.duration 偏短 */
const MIN_VISIBLE_MS = 400;

/** 箭头类事件最小播放时长(ms),保证 ActionOverlay 有足够时间渲染箭头。
 *  指定目标/成为目标 atom 的 effect.duration 仅 400ms,与 MIN_VISIBLE_MS 相同;
 *  多个事件同批到达时队列快速推进,后续事件会在 400ms 内覆盖当前事件,
 *  React 渲染周期 + findSeatEl DOM 查询来不及完成,箭头来不及渲染或一闪而过。 */
const ARROW_MIN_MS = 1200;
/** 需要延长播放时长的事件类型(携带 source+target 的箭头触发事件) */
const ARROW_EVENT_TYPES = new Set(['指定目标', '成为目标']);

/** 粘性展示事件类型:火攻/界火计/义绝/蛊惑 等「展示手牌」。
 *  这类事件走「粘性展示卡」:由 GameView 从 ingested 派生常驻显示
 *  (顶部中央翻入后停住,不淡出),玩家可同时操作,任何动作提交后立即消失。
 *  不进 banner 队列的原因:队列按 duration 定时出队,展示会 (a) 占用定时槽、
 *  (b) 经 isPlayingFlipAnim 门控 AwaitingPrompt 强制玩家干等动画播完——
 *  火攻使用者恰恰要看着展示牌的花色去手牌里挑同花色,阻塞反而拖慢决策。 */
const STICKY_REVEAL_TYPES = new Set(['展示']);

/**
 * 结构性事件:回合/阶段开始·结束。这些事件无卡牌、无目标,中央横幅本就不渲染它们
 * (EventBanner 需 card 字段,ActionOverlay 需 target),进入播放队列只是 duration 空转,
 * 会阻塞后续牌操作事件的展示。让它们退出 banner 队列(仅响音效 + 进历史条),
 * 回合切换不再串行累积数百毫秒延迟。
 */
const STRUCTURAL_TYPES = new Set(['回合开始', '回合结束', '阶段开始', '阶段结束']);

function isStructural(event: ViewEvent): boolean {
  return STRUCTURAL_TYPES.has(event.type);
}

export interface QueuedEvent {
  seq: number;
  event: ViewEvent;
}

export interface EventPlaybackState {
  /** 待播事件队列(seq 升序) */
  queue: QueuedEvent[];
  /** 当前正在播放的事件(null = 空闲) */
  current: QueuedEvent | null;
}

/**
 * 事件播放队列。
 *
 * @returns { current, ingested, enqueue, reset, skipAll, pendingCount }
 *   - current: 当前延时播放中的事件(箭头/判定翻牌等)
 *   - ingested: 最近一次入队的新鲜事件批次(出牌历史条应立即消费,不等播放队列)
 *   - pendingCount: 待播队列积压数(不含 current,供「+N 排队中」角标)
 *   - skipAll: 一键清空积压并按最新 seq 对齐(供横幅跳过按钮)
 */
export function useEventPlayback() {
  const [current, setCurrent] = useState<QueuedEvent | null>(null);
  /** 最近入队批次;每次 enqueue 新鲜事件时更新,供 PlayHistory 立即入条 */
  const [ingested, setIngested] = useState<QueuedEvent[]>([]);
  /** 待播队列积压数(queueRef 长度,不含当前播放中事件)。
   *  入队/出队/清空时同步,供 UI 显示「+N 排队中」角标与一键跳过入口。 */
  const [pendingCount, setPendingCount] = useState(0);
  const queueRef = useRef<QueuedEvent[]>([]);
  const lastPlayedSeqRef = useRef(0);
  /** ingested 去重 seq:结构事件不入播放队列、不推进 lastPlayedSeqRef,
   *  需独立跟踪已入 ingested 的最大 seq,防止重复。 */
  const ingestedSeqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用 ref 而非 current state 判断是否正在播放:多条 WS 消息在同一 tick 内同步到达时,
  // current state 在闭包中还是旧值(null),会导致 playNext 被重复调用,事件被瞬间覆盖。
  // ref 是同步可变的,不受 React render 周期影响。
  const isPlayingRef = useRef(false);

  /** 从队列取下一个播放 */
  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      isPlayingRef.current = false;
      setCurrent(null);
      return;
    }
    isPlayingRef.current = true;
    setCurrent(next);
    setPendingCount(queueRef.current.length);
    // duration:ViewEvent 自带 effect → atom 静态 effect(atomType 优先)→ 下限
    // 注意:打出/弃牌 等 ViewEvent.type 不是 atom 名,必须用 atomType,且查表失败时不能抛。
    const type = next.event.atomType ?? next.event.type;
    let staticDuration: number | undefined;
    try {
      staticDuration = getAtomDef(type).effect?.duration;
    } catch {
      staticDuration = undefined;
    }
    const eventEffect = next.event.effect as { duration?: number } | undefined;
    const duration = eventEffect?.duration ?? staticDuration ?? MIN_VISIBLE_MS;
    // 箭头类事件(指定目标/成为目标)强制更长最小播放时长,避免后续事件过快覆盖、
    // 箭头来不及渲染。其他事件仍走 MIN_VISIBLE_MS 下限。
    const isArrowEvent = ARROW_EVENT_TYPES.has(next.event.type);
    const minMs = isArrowEvent ? ARROW_MIN_MS : MIN_VISIBLE_MS;
    // 每条事件播放时实时读速度档位:切换即时生效于「下一条」事件,
    // 当前正在播的事件定时器不受影响(不打断,符合语义)。
    const speedFactor = getAnimSpeed() === 'fast' ? 0.5 : 1;
    const wait = Math.max(duration, minMs) * speedFactor;
    timerRef.current = setTimeout(() => {
      lastPlayedSeqRef.current = next.seq;
      playNext();
    }, wait);
  }, []);

  /**
   * 入队一批事件并开始播放(若空闲)。
   * 过时事件(seq <= lastPlayedSeq)被丢弃。
   * 新鲜事件同时写入 ingested,供出牌历史「使用时立即展示」。
   */
  const enqueue = useCallback(
    (events: QueuedEvent[]) => {
      if (events.length === 0) return;
      // ingested 去重:用独立 seq ref,不受 banner 队列推进影响
      const fresh = events.filter((e) => e.seq > ingestedSeqRef.current);
      if (fresh.length === 0) return;
      ingestedSeqRef.current = Math.max(...fresh.map((e) => e.seq));
      // 每次入队用新数组引用,确保下游 useEffect 能触发
      setIngested(fresh.map((e) => e));
      // 结构事件(回合/阶段)不进 banner 队列:它们无 card/target,横幅不渲染,
      // 入队只是 duration 空转,会阻塞后续牌操作事件。音效由 useSoundPlayback 跟 ingested 响。
      // 展示事件走粘性卡(见 STICKY_REVEAL_TYPES),同样退出定时队列。
      const bannerEvents = fresh.filter(
        (e) => !isStructural(e.event) && !STICKY_REVEAL_TYPES.has(e.event.type),
      );
      if (bannerEvents.length > 0) {
        queueRef.current.push(...bannerEvents);
        setPendingCount(queueRef.current.length);
        // 若空闲,立即开始播放(用 ref 判断,避免闭包竞态)
        if (!isPlayingRef.current) {
          playNext();
        }
      }
    },
    [playNext],
  );

  /** 重置(重连时清空状态,避免播放历史事件) */
  const reset = useCallback((baselineSeq: number) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    queueRef.current = [];
    setPendingCount(0);
    isPlayingRef.current = false;
    setCurrent(null);
    setIngested([]);
    lastPlayedSeqRef.current = baselineSeq;
    ingestedSeqRef.current = baselineSeq;
  }, []);

  /**
   * 一键跳过积压:清空待播队列与当前横幅,seq 基线对齐到最新已摄入事件
   * (ingestedSeqRef 是「已见过的最大 seq」,含结构/展示等退出 banner 队列的事件),
   * 后续 seq 更大的新事件照常入队播放。
   *
   * 走既有 reset 路径,下游动画不会卡中间态:
   *   - 伤害闪烁/回血漂浮数字由 useAnimationState 从 view.players HP diff 派生,
   *     与本队列完全解耦(view 由 WS 独立更新,本就是最新,无需二次对齐);
   *   - 横幅卡/箭头(ActionOverlay)挂在 current 上,current 置 null 即卸载,
   *     CSS 动画随 DOM 节点销毁,不存在悬挂定时器;
   *   - isPlayingFlipAnim(GameView 据此门控 AwaitingPrompt)随 current=null 立即
   *     解除,待应答提示即刻可见——正是「对齐最新」的语义;
   *   - 已起飞的飞牌/音效/特效消费的是 ingested 即时批次,fire-and-forget 自行播完。
   */
  const skipAll = useCallback(() => {
    reset(ingestedSeqRef.current);
  }, [reset]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { current, ingested, enqueue, reset, skipAll, pendingCount };
}
