// src/client/components/ActionOverlay.tsx
// 动作浮层 + 箭头动效层。
//
// 设计目标:增强玩家对「谁在用什么牌对谁做什么」的可感知性。
//   1. 箭头:在「使用者」与「目标」之间画一条持续数秒的箭头。
//      触发事件:成为目标 / 造成伤害 / 失去体力 / 指定目标。
//      其中 指定目标/成为目标 携带 cardId+cardName+source+target,
//      能完整还原「杀指定张角」这种语义。
//   2. 浮层小窗:在屏幕中央上方展示一句话「刘备 杀 张角」。
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
  /** 卡牌名(杀/南蛮入侵/...)
   *  指定目标/成为目标 atom 携带 cardName;造成伤害/失去体力 无 cardName,
   *  但其前驱事件(成为目标/打出)已在队列中给过名字,前端依赖 current 序列即可。*/
  cardName?: string;
  /** 事件类型,用于区分文案 */
  eventType: string;
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
  return null;
}

type ViewEventLike = {
  type?: string;
  atomType?: string;
  source?: unknown;
  target?: unknown;
  player?: unknown;
  cardName?: unknown;
  card?: { name?: unknown } | undefined;
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

/** 浮层显示时长(ms):与 effect.duration 对齐,默认 1500ms。 */
const DEFAULT_DURATION_MS = 1500;
/** 群锦囊持续展示时长(ms):给玩家更多时间看清「轮到谁」。 */
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
  // view 以 ref 形式持有:effect 只依赖 current,避免每次 view 变化重算箭头。
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!current) {
      setInfo(null);
      setArrow(null);
      return;
    }
    const event = current.event as ViewEventLike;
    let action = extractAction(event);
    if (!action) {
      setInfo(null);
      setArrow(null);
      return;
    }
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
    setInfo(action);

    // 计算箭头坐标:起点=source 座位中央,终点=target 座位中央
    if (action.target !== undefined && action.target !== action.source) {
      const srcEl = findSeatEl(viewRef.current, action.source);
      const dstEl = findSeatEl(viewRef.current, action.target);
      if (srcEl && dstEl) {
        const r1 = srcEl.getBoundingClientRect();
        const r2 = dstEl.getBoundingClientRect();
        setArrow({
          x1: r1.left + r1.width / 2,
          y1: r1.top + r1.height / 2,
          x2: r2.left + r2.width / 2,
          y2: r2.top + r2.height / 2,
        });
      } else {
        setArrow(null);
      }
    } else {
      setArrow(null);
    }

    // 浮层持续时间:群锦囊+目标命中时拉长;否则默认
    const isBroadcast =
      action.cardName !== undefined && BROADCAST_TRICKS.has(action.cardName);
    const dur = isBroadcast ? BROADCAST_DURATION_MS : DEFAULT_DURATION_MS;
    timerRef.current = setTimeout(() => {
      setInfo(null);
      setArrow(null);
    }, dur);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [current]);

  if (!info) return null;

  const sourceName = view.players.find((p) => p.index === info.source)?.name ?? `P${info.source}`;
  const targetName =
    info.target !== undefined
      ? view.players.find((p) => p.index === info.target)?.name ?? `P${info.target}`
      : undefined;

  // 文案:
  //   指定目标/成为目标:刘备 杀 张角
  //   造成伤害:刘备 → 张角 (伤害)
  //   失去体力:张角 失去 1 点体力
  //   打出:刘备 使用 南蛮入侵 [→ 当前轮到 张角]
  let text: string;
  if (info.eventType === '指定目标' || info.eventType === '成为目标') {
    text = `${sourceName}${info.cardName ? ` ${info.cardName} ` : ' → '}${targetName ?? ''}`;
  } else if (info.eventType === '造成伤害') {
    text = `${sourceName} → ${targetName ?? ''} 伤害`;
  } else if (info.eventType === '失去体力') {
    text = `${sourceName} 失去体力`;
  } else {
    // 打出
    const tail = targetName ? ` → ${targetName}` : '';
    text = `${sourceName} 使用 ${info.cardName ?? '牌'}${tail}`;
  }

  return (
    <div className={overlayRoot} style={{ pointerEvents: 'none' } as CSSProperties}>
      {arrow && (
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
      <div className={banner}>
        <span className={bannerText}>{text}</span>
      </div>
    </div>
  );
}

// ─── Styles ───
const overlayRoot = css`
  position: fixed;
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

const banner = css`
  position: absolute;
  top: 14%;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(180deg, rgba(40, 12, 12, 0.92), rgba(60, 18, 18, 0.92));
  border: 2px solid #ffd700;
  border-radius: 12px;
  padding: 10px 28px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 215, 0, 0.3);
  color: #fff;
  font-size: 18px;
  font-weight: bold;
  letter-spacing: 2px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
  animation: bannerIn 0.35s ease-out both;
  pointer-events: none;
  max-width: 80vw;
`;

const bannerText = css`
  display: inline-block;
`;
