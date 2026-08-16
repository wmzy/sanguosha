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
//
// 队列积压指示:待播事件 >1 条时顶部中央渲染「+N 排队中」角标 + ⏭ 一键清空
// (调用 useEventPlayback.skipAll,走 reset 按最新 seq 对齐;仅按钮开启命中)。
// 共享数据(view)来自 GameViewCtx,专属数据(current/reveal/pendingCount/onSkip)仍走 props。

import * as styles from './gameViewStyles';
import { SUIT_COLOR } from './gameViewConstants';
import { CardFace } from './CardFace';
import { useGameView } from './GameViewCtx';
import type { GameView, Card, ViewEvent } from '../../engine/types';
import { getAtomDef } from '../../engine/core/atom';
import type { QueuedEvent } from '../hooks/useEventPlayback';

/** ViewEvent 自带的 effect 片段(移动牌等派生事件携带;静态 atom 走 getAtomDef) */
type EventEffect = { animation?: string; duration?: number } | undefined;

export interface EventBannerProps {
  /** 当前播放的事件(null = 空闲,不渲染) */
  current: QueuedEvent | null;
  /** 粘性展示卡(火攻等「展示手牌」):最新展示事件,常驻至玩家操作/新展示。
   *  顶部中央翻入后停住(不淡出),不门控任何交互。 */
  reveal?: ViewEvent | null;
  /** 待播队列积压数(useEventPlayback.pendingCount,不含当前播放中事件)。
   *  >1 时显示「+N 排队中」角标(积压感知:串行播放每条 ≥400ms,箭头 1200ms)。 */
  pendingCount?: number;
  /** 一键清空积压:清空播放队列并按最新 seq 对齐,后续新事件照常播放。
   *  不提供则不显示角标(回放等无队列场景)。 */
  onSkip?: () => void;
}

export function EventBanner({
  current,
  reveal = null,
  pendingCount = 0,
  onSkip,
}: EventBannerProps) {
  // 共享数据来自 GameViewCtx(view:粘性展示卡查展示者玩家名)
  const { view } = useGameView();
  // 粘性展示卡:独立于定时队列渲染(即使队列空闲也常驻,不门控任何交互)
  const revealNode = renderRevealCard(reveal, view);
  return (
    <>
      {revealNode}
      {renderBacklogBadge(pendingCount, onSkip, !!revealNode)}
      {renderBanner(current)}
    </>
  );
}

/** 队列积压指示:待播 >1 条时顶部中央显示「+N 排队中」+ ⏭ 清空按钮。
 *  粘性展示卡在场时下移避让(同占 top:8 中央位)。
 *  容器 pointer-events:none,仅按钮可点(不挡座位/手牌交互)。 */
function renderBacklogBadge(
  pendingCount: number,
  onSkip: (() => void) | undefined,
  hasReveal: boolean,
) {
  if (pendingCount <= 1 || !onSkip) return null;
  return (
    <div
      className={
        hasReveal
          ? `${styles.eventBacklogLayer} ${styles.eventBacklogBelowReveal}`
          : styles.eventBacklogLayer
      }
    >
      <span className={styles.eventBacklogBadge}>+{pendingCount} 排队中</span>
      <button
        type="button"
        className={styles.eventBacklogSkipBtn}
        onClick={onSkip}
        title="清空积压事件，立即对齐到最新"
        aria-label="清空积压事件"
      >
        ⏭
      </button>
    </div>
  );
}

/** 粘性展示卡:火攻/界火计/义绝/蛊惑 等「展示手牌」事件的常驻渲染。
 *  顶部中央翻入(revealCardIn)后停住,不淡出;消失由 React 卸载驱动
 *  (玩家操作 send / 新展示事件替换),展示时长不受定时限制。 */
function renderRevealCard(reveal: ViewEvent | null, view: GameView) {
  if (!reveal) return null;
  const card = reveal.card as Pick<Card, 'name' | 'suit' | 'rank'> | undefined;
  if (!card) return null;
  const effect = reveal.effect as EventEffect;
  const ownerName = view.players[reveal.player as number]?.name;
  return (
    <div className={styles.revealCardLayer}>
      <div
        className={styles.revealCard}
        style={
          {
            '--flip-duration': `${effect?.duration ?? 700}ms`,
            '--suit-color': SUIT_COLOR[card.suit] ?? '#ccc',
          } as React.CSSProperties
        }
      >
        <div className={styles.eventCardLabel}>{ownerName ? `${ownerName} 展示` : '展示'}</div>
        <div className={styles.eventCardBody}>
          <CardFace name={card.name} suit={card.suit} rank={card.rank} size="large" />
        </div>
      </div>
    </div>
  );
}

/** 中央定时横幅(原 EventBanner 主体) */
function renderBanner(current: QueuedEvent | null) {
  if (!current) return null;

  const atomType = current.event.atomType ?? current.event.type;
  const def = getAtomDef(atomType);
  // 优先用 ViewEvent 自带 effect(移动牌派生的「打出」等事件),fallback 到 atom 静态 effect。
  // 移动牌 是底层通用 atom 无静态 effect,其 toViewEvents 为各语义分支(打出/弃牌/摸牌)
  // 单独构造 effect,必须从这里取,否则 animation/duration 查不到。
  const effect = (current.event.effect as EventEffect) ?? def.effect;

  // 取动画名;flip 走原 3D 翻牌逻辑,fade/shake/pulse/slide/highlight/flash 走通用分支。
  const animName = effect?.animation;
  if (!animName) return null;

  // 必须有 card 字段(判定牌 / 打出的牌等)
  const card = current.event.card as Pick<Card, 'name' | 'suit' | 'rank'> | undefined;
  if (!card) return null;

  const eventType = current.event.type;
  // 打出由中央 PlayHistoryStrip 展示,不再翻牌;仅判定等保留 flip。
  if (eventType === '打出') return null;

  // 非 flip 系统动效：渲染中央浮动卡牌 + CSS animation(全局 animations.css 的 keyframes)。
  // duration 默认 400ms(flip 默认 1800ms 由下方原逻辑保留)。
  if (animName !== 'flip') {
    const duration = effect?.duration ?? 400;
    return (
      <div className={styles.eventCardLayer}>
        <div style={{ animation: `${animName} ${duration}ms ease-in-out` }}>
          <CardFace name={card.name} suit={card.suit} rank={card.rank} size="large" />
        </div>
      </div>
    );
  }

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
