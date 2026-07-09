// src/client/components/ZoneInfoBar.tsx
// 中央信息区:牌堆数 + 处理区 + 弃牌堆。纯展示,数据全部由 view 传入。
import { memo } from 'react';
import * as styles from './gameViewStyles';
import type { GameView } from '../../engine/types';
import { SUIT_COLOR } from './gameViewConstants';

export interface ZoneInfoBarProps {
  view: GameView;
}

function ZoneInfoBarImpl(props: ZoneInfoBarProps) {
  const { view } = props;

  return (
    <div className={styles.centerMeta}>
      <div className={styles.metaText}>
        牌堆: {view.zones?.deckCount ?? Object.keys(view.cardMap).length} 张
      </div>
      {/* 处理区:中间结算的牌(判定牌 / 闪抵消杀) */}
      {(() => {
        const procIds = view.zones?.processing ?? [];
        if (procIds.length === 0) return null;
        return (
          <div className={styles.processingRow} title="处理区:正在结算的中间牌(判定/抵消等)">
            <span className={styles.processingLabel}>处理区:</span>
            {procIds.map((cardId: string) => {
              const card = view.cardMap[cardId];
              if (!card) return null;
              const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
              const desc = card.description ?? '';
              return (
                <span
                  key={cardId}
                  className={styles.processingTag}
                  style={{ '--suit-color': suitColor } as React.CSSProperties}
                  title={desc || card.name}
                >
                  {card.name} {card.suit}
                  {card.rank}
                </span>
              );
            })}
          </div>
        );
      })()}
      {/* 弃牌堆:右上角一个小图标 + 数字 */}
      <div className={styles.discardPileRow}>
        <span className={styles.discardPileIcon} title="弃牌堆">
          🗂
        </span>
        <span className={styles.discardPileCount}>弃牌: {view.zones?.discardPileCount ?? 0}</span>
      </div>
    </div>
  );
}

/** memo: 只在牌堆数/弃牌堆/处理区变化时重渲染 */
function zoneInfoBarPropsEqual(prev: ZoneInfoBarProps, next: ZoneInfoBarProps): boolean {
  const az = prev.view.zones;
  const bz = next.view.zones;
  // 处理区:比较 cardId 集合 + 对应卡片名(cardMap 查找确定性)
  const aProc = az?.processing ?? [];
  const bProc = bz?.processing ?? [];
  if (aProc.length !== bProc.length) return false;
  for (let i = 0; i < aProc.length; i++) {
    if (aProc[i] !== bProc[i]) return false;
  }
  return (
    (az?.deckCount ?? 0) === (bz?.deckCount ?? 0) &&
    (az?.discardPileCount ?? 0) === (bz?.discardPileCount ?? 0)
  );
}

export const ZoneInfoBar = memo(ZoneInfoBarImpl, zoneInfoBarPropsEqual);
