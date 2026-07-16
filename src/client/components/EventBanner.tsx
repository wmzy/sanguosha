// src/client/components/EventBanner.tsx
// Effect 驱动的事件卡牌动效层(GameView 内部,非阻塞)。
//
// 当 useEventPlayback 的 current event 的 effect.animation === 'flip'
// 且 ViewEvent 携带 card 字段时,渲染一张中央浮动卡牌:
//   1. 从上方弹出(模拟从牌堆翻出)
//   2. 3D 翻转揭示花色点数
//   3. effect.duration 到点后消失(由 useEventPlayback 出队驱动)
//
// 判定牌的「停留在处理区」由 useDebugMultiConnection 的 processing 延迟逻辑
// + ZoneInfoBar 渲染负责,本组件只负责翻牌瞬间的动效。
//
// 非 effect.animation='flip' 的事件不渲染(无卡牌动效需求)。
// pointer-events: none —— 不拦截玩家交互。

import * as styles from './gameViewStyles';
import { SUIT_COLOR } from './gameViewConstants';
import type { GameView, Card } from '../../engine/types';
import { getAtomDef } from '../../engine/atom';
import type { QueuedEvent } from '../hooks/useEventPlayback';

/** ViewEvent 自带的 effect 片段(移动牌等派生事件携带;静态 atom 走 getAtomDef) */
type EventEffect = { animation?: string; duration?: number } | undefined;

export interface EventBannerProps {
  /** 当前播放的事件(null = 空闲,不渲染) */
  current: QueuedEvent | null;
  view: GameView;
}

export function EventBanner({ current, view }: EventBannerProps) {
  if (!current) return null;

  const atomType = current.event.atomType ?? current.event.type;
  const def = getAtomDef(atomType);
  // 优先用 ViewEvent 自带 effect(移动牌派生的「打出」等事件),fallback 到 atom 静态 effect。
  // 移动牌 是底层通用 atom 无静态 effect,其 toViewEvents 为各语义分支(打出/弃牌/摸牌)
  // 单独构造 effect,必须从这里取,否则 animation/duration 查不到。
  const effect = (current.event.effect as EventEffect) ?? def.effect;

  // 只处理 flip 动画类型(翻牌动效)
  if (effect?.animation !== 'flip') return null;

  // 必须有 card 字段(判定牌 / 打出的牌等)
  const card = current.event.card as Pick<Card, 'name' | 'suit' | 'rank'> | undefined;
  if (!card) return null;

  const eventType = current.event.type;
  const player = current.event.player as number | undefined;
  // 自己出牌:usePlayInteraction 已触发 createCardFlyAnimation(手牌→中央),
  // 跳过中央翻牌避免重复动画;仅为他人生成翻牌动效。
  if (eventType === '打出' && player !== undefined && player === view.viewer) return null;

  const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
  // 判定事件额外显示 judgeType 标签
  const judgeType = current.event.judgeType as string | undefined;
  // 打出事件:显示来源玩家名(让其它玩家看清谁出了什么牌)
  const playerName =
    eventType === '打出' && player !== undefined
      ? view.players.find((p) => p.index === player)?.name
      : undefined;

  return (
    <div className={styles.eventCardLayer}>
      <div
        className={styles.eventCardFlip}
        style={
          {
            '--flip-duration': `${effect?.duration ?? 1800}ms`,
            '--suit-color': suitColor,
          } as React.CSSProperties
        }
      >
        {/* judgeType 小标签(判定事件) */}
        {judgeType && <div className={styles.eventCardLabel}>{judgeType}</div>}
        {/* 来源玩家名(打出事件) */}
        {playerName && <div className={styles.eventCardPlayer}>{playerName}</div>}
        {/* 卡牌主体 */}
        <div className={styles.eventCardBody}>
          <div className={styles.eventCardName}>{card.name}</div>
          <div className={styles.eventCardSuit}>
            {card.suit}
            {card.rank}
          </div>
        </div>
      </div>
    </div>
  );
}
