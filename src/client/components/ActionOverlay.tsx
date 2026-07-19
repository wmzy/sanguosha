// src/client/components/ActionOverlay.tsx
// 动作浮层 + 箭头动效层。
//
// 设计目标:增强玩家对「谁在用什么牌对谁做什么」的可感知性。
//   1. 箭头:在「使用者」与「目标」之间画一条持续数秒的箭头。
//      触发事件:成为目标 / 造成伤害 / 失去体力 / 指定目标。
//      其中 指定目标/成为目标 携带 cardId+cardName+source+target,
//      能完整还原「杀指定张角」这种语义。
//   2. 浮层小窗:在屏幕中央展示一句话「刘备 杀 张角」。
//      名字取自 view.players[index].name(分配武将后即武将名,如刘备/张角);
//      未来可改用武将缩略图替代纯文字。
//   3. 群锦囊(五谷丰登/南蛮入侵/万箭齐发/桃园结义)无固定目标,
//      但有 source+cardName,浮层显示「刘备 使用 南蛮入侵」,箭头指向当前轮到结算的角色。
//      群锦囊当前结算角色由 view.pending.target 指示(询问闪/询问杀/选牌),
//      若 pending 精准命中某座次则把目标设为该座次,否则无箭头(只有浮层)。
//
// 与 EventBanner 的分工:
//   EventBanner 渲染「打出 / 判定」等翻牌中央卡牌动画(flip)。
//   ActionOverlay 渲染「语义动作」的箭头+文本浮层,补足「谁对谁」的可感知性。
//   两者可同时存在(useEventPlayback 队列已串行化),但 ActionOverlay 只监听
//   带目标的事件,不会与 EventBanner 重叠渲染同一类型。
//
// 非阻塞:pointer-events:none。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { css } from '@linaria/core';
import type { GameView } from '../../engine/types';
import type { QueuedEvent } from '../hooks/useEventPlayback';

type Player = GameView['players'][number];

/** 箭头浮层显示的「动作」信息。 */
interface ActionInfo {
  /** 来源玩家座次 */
  source: number;
  /** 目标玩家座次(undefined 表示无目标,只显示文本浮层) */
  target?: number;
  /** 卡牌名(杀/南蛮入侵/...) */
  cardName?: string;
  /** 事件类型,用于区分文案 */
  eventType: string;
  /** 判定事件专用:判定类型(乐不思蜀/闪电/八卦阵等) */
  judgeType?: string;
  /** 判定事件专用:判定牌花色 */
  suit?: string;
  /** 判定事件专用:判定牌点数 */
  rank?: string;
}

/** 从 ViewEvent 提取 ActionInfo。
 *  支持的事件:指定目标/成为目标/造成伤害/失去体力/打出。
 *  其他事件返回 null。 */
function extractAction(event: ViewEventLike): ActionInfo | null {
  const t = event.type;
  const source = num(event.source);
  const target = num(event.target);
  if (t === '指定目标' || t === '成为目标') {
    if (source === undefined || target === undefined) return null;
    const cardName = str(event.cardName);
    return { source, target, cardName, eventType: t };
  }
  if (t === '造成伤害' || t === '失去体力') {
    if (target === undefined) return null;
    // 造成伤害带 source;失去体力没有 source,无箭头(只有浮层)
    if (t === '造成伤害' && source !== undefined) {
      return { source, target, eventType: t };
    }
    return { source: source ?? target, target, eventType: t };
  }
  if (t === '打出') {
    // 打出事件:player=来源,无 target。需结合 cardName 显示「X 使用 Y」,
    // 箭头从 source 指向 view.pending.target(若该 pending 命中某座次)。
    const p = num(event.player);
    if (p === undefined) return null;
    return { source: p, cardName: str((event.card as { name?: unknown } | undefined)?.name), eventType: t };
  }
  if (t === '判定') {
    // 判定事件:player=判定者,judgeType=判定类型(乐不思蜀/闪电/八卦阵等),
    // card=判定牌(花色点数+牌名)。浮层显示「张角 判定(乐不思蜀):翻出 ♥3 桃」。
    // 判定无目标 → 不画箭头,只有浮层。
    const p = num(event.player);
    if (p === undefined) return null;
    const card = event.card;
    return {
      source: p,
      cardName: str(card?.name),
      eventType: t,
      judgeType: str(event.judgeType),
      suit: str(card?.suit),
      rank: str(card?.rank),
    };
  }
  return null;
}

type ViewEventLike = {
  type?: string;
  atomType?: string;
  source?: unknown;
  target?: unknown;
  player?: unknown;
  cardName?: unknown;
  card?: { name?: unknown; suit?: unknown; rank?: unknown } | undefined;
  judgeType?: unknown;
};

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 查询座次对应 DOM 元素:优先 data-player-name 精确匹配,回退座次序号。
 *  PlayerSeatView 与 PlayerCardLarge 都已加 data-player-name=player.name。 */
function findSeatEl(view: GameView, idx: number): HTMLElement | null {
  const p: Player | undefined = view.players.find((q) => q.index === idx);
  if (!p) return null;
  return document.querySelector<HTMLElement>(`[data-player-name="${cssEscape(p.name)}"]`);
}

/** 简单 CSS escape:仅处理常见特殊字符,避免引入 full CSS.escape polyfill。 */
function cssEscape(s: string): string {
  return s.replace(/["\\\]\[]/g, '\\$&');
}

export interface ActionOverlayProps {
  current: QueuedEvent | null;
  view: GameView;
}

/** 箭头显示时长(ms) */
const DEFAULT_DURATION_MS = 3500;
/** 群锦囊箭头持续展示时长(ms) */
const BROADCAST_DURATION_MS = 2200;

/** 群锦囊卡名(无固定目标,通过 pending 指示当前结算角色) */
const BROADCAST_TRICKS = new Set([
  '五谷丰登',
  '南蛮入侵',
  '万箭齐发',
  '桃园结义',
  '铁索连环',
  '闪电',
]);

export function ActionOverlay({ current, view }: ActionOverlayProps) {
  // 用 state 而非每次 render 都计算 DOM:ActionInfo 只在 current 变化时更新。
  const [info, setInfo] = useState<ActionInfo | null>(null);
  const [arrow, setArrow] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // view 以 ref 形式持有:effect 只依赖 current,避免每次 view 变化重算箭头。
  const viewRef = useRef(view);
  viewRef.current = view;

  // 浮层展示与事件队列解耦:指定目标等 atom 的 effect.duration 仅 400ms,
  // 若跟 current 切走就清掉,用户几乎看不清。有新动作才刷新;无动作/队列空时让计时器跑完。
  useEffect(() => {
    if (!current) return;
    const event = current.event as ViewEventLike;
    let action = extractAction(event);
    if (!action) return;

    // 群锦囊场景:打出事件 + 当前 pending 命中某座次 → 把目标设为该座次,
    // 浮层展示「X 使用 群锦囊」+ 箭头指向当前轮到结算的角色。
    const pendingTarget = viewRef.current.pending?.target;
    if (
      action.eventType === '打出' &&
      action.cardName &&
      BROADCAST_TRICKS.has(action.cardName) &&
      pendingTarget !== undefined &&
      pendingTarget >= 0
    ) {
      action = { ...action, target: pendingTarget };
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // 仅在有目标时保留箭头;无目标动作不占浮层
    if (action.target === undefined || action.target === action.source) {
      setArrow(null);
      // 仍记录 info 以便计时清理,但不强制显示
      setInfo(action);
    } else {
      setInfo(action);
      const srcEl = findSeatEl(viewRef.current, action.source);
      const dstEl = findSeatEl(viewRef.current, action.target);
      const rootEl = rootRef.current;
      if (srcEl && dstEl && rootEl) {
        const origin = rootEl.getBoundingClientRect();
        const r1 = srcEl.getBoundingClientRect();
        const r2 = dstEl.getBoundingClientRect();
        setArrow({
          x1: r1.left + r1.width / 2 - origin.left,
          y1: r1.top + r1.height / 2 - origin.top,
          x2: r2.left + r2.width / 2 - origin.left,
          y2: r2.top + r2.height / 2 - origin.top,
        });
      } else {
        setArrow(null);
      }
    }

    const isBroadcast =
      action.cardName !== undefined && BROADCAST_TRICKS.has(action.cardName);
    const isJudge = action.eventType === '判定';
    const dur = isBroadcast
      ? BROADCAST_DURATION_MS
      : isJudge
        ? 1800
        : DEFAULT_DURATION_MS;
    timerRef.current = setTimeout(() => {
      setInfo(null);
      setArrow(null);
      timerRef.current = null;
    }, dur);
  }, [current]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // 始终挂载 root(保证 rootRef 可用于箭头坐标换算);无箭头时不画内容
  // 文字浮层已由中央 PlayHistoryStrip 替代,此处只保留座位间箭头。
  return (
    <div ref={rootRef} className={overlayRoot} style={{ pointerEvents: 'none' } as CSSProperties}>
      {info && arrow && (
        <svg className={arrowSvg} style={{ pointerEvents: 'none' }}>
          <defs>
            <marker
              id="actionArrowHead"
              markerWidth="12"
              markerHeight="12"
              refX="9"
              refY="6"
              orient="auto"
            >
              <path d="M0,0 L10,6 L0,12 L3,6 Z" fill="#ff5555" />
            </marker>
          </defs>
          <line
            x1={arrow.x1}
            y1={arrow.y1}
            x2={arrow.x2}
            y2={arrow.y2}
            stroke="#ff5555"
            strokeWidth="3"
            strokeDasharray="8 6"
            markerEnd="url(#actionArrowHead)"
            className={arrowLine}
          />
        </svg>
      )}
    </div>
  );
}

// ─── Styles ───
/** 相对 battleField 铺满,箭头坐标相对战场 */
const overlayRoot = css`
  position: absolute;
  inset: 0;
  z-index: 9998;
  pointer-events: none;
`;

const arrowSvg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

const arrowLine = css`
  animation: arrowPulse 1s ease-in-out infinite;
  filter: drop-shadow(0 0 6px rgba(255, 85, 85, 0.5));
`;
