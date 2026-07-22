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
import { CardFace } from './CardFace';
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

export function EventBanner({ current }: EventBannerProps) {
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
  // 打出由中央 PlayHistoryStrip 展示,不再翻牌;仅判定等保留 flip。
  if (eventType === '打出') return null;

  const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
  const judgeType = current.event.judgeType as string | undefined;
  // 待判定牌:判定区同名延时锦囊(乐不思蜀/闪电/兵粮寸断)的牌面,由判定 atom
  // toViewEvents 在 apply 前从 pendingTricks 携带。技能判定(八卦阵/铁骑等)无此字段。
  const pendingCard = current.event.pendingCard as
    | { name: string; suit: string; rank: string }
    | undefined;

  // 判定结果翻牌卡(翻牌动画只作用于判定结果,待判定牌不翻转)
  const resultFlip = (
    <div
      className={styles.eventCardFlip}
      style={
        {
          '--flip-duration': `${effect?.duration ?? 1800}ms`,
          '--suit-color': suitColor,
        } as React.CSSProperties
      }
    >
      {judgeType && <div className={styles.eventCardLabel}>{judgeType}</div>}
      <div className={styles.eventCardBody}>
        <CardFace name={card.name} suit={card.suit} rank={card.rank} size="large" />
      </div>
    </div>
  );

  return (
    <div className={styles.eventCardLayer}>
      {pendingCard ? (
        <div className={styles.judgeGroup}>
          <div className={styles.judgePendingWrap}>
            <div className={styles.eventCardLabel}>待判定</div>
            <div className={styles.judgePendingBody}>
              <CardFace
                name={pendingCard.name}
                suit={pendingCard.suit}
                rank={pendingCard.rank}
                size="normal"
              />
            </div>
          </div>
          <div className={styles.judgeConnector}>判定为</div>
          {resultFlip}
        </div>
      ) : (
        resultFlip
      )}
    </div>
  );
}
