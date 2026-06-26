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

export interface EventBannerProps {
  /** 当前播放的事件(null = 空闲,不渲染) */
  current: QueuedEvent | null;
  view: GameView;
}

export function EventBanner({ current, view: _view }: EventBannerProps) {
  if (!current) return null;

  const type = current.event.atomType ?? current.event.type;
  const def = getAtomDef(type);
  const effect = def.effect;

  // 只处理 flip 动画类型(翻牌动效)
  if (effect?.animation !== 'flip') return null;

  // 必须有 card 字段(判定牌 / 打出的牌等)
  const card = current.event.card as Pick<Card, 'name' | 'suit' | 'rank'> | undefined;
  if (!card) return null;

  const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
  // 判定事件额外显示 judgeType 标签
  const judgeType = current.event.judgeType as string | undefined;

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
