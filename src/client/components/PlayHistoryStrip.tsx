// src/client/components/PlayHistoryStrip.tsx
// 对战区中央出牌历史条:FIFO 小牌 + 下方短标注(谁对谁 / 谁弃)。

import { memo } from 'react';
import { css } from '@linaria/core';
import { SUIT_COLOR } from './gameViewConstants';
import type { PlayHistoryItem } from '../utils/playHistoryQueue';

export type PlayHistoryStripProps = {
  items: PlayHistoryItem[];
};

function PlayHistoryStripImpl({ items }: PlayHistoryStripProps) {
  return (
    <div className={strip} aria-label="出牌展示" data-play-history-count={items.length}>
      {items.map((it) => {
        const suitColor = SUIT_COLOR[it.card.suit ?? ''] ?? '#ccc';
        return (
          <div key={it.id} className={slot}>
            <div className={cardFace} style={{ borderColor: suitColor }}>
              <div className={cardName} style={{ color: suitColor }}>
                {it.card.name}
              </div>
              {(it.card.suit || it.card.rank) && (
                <div className={cardSuit} style={{ color: suitColor }}>
                  {it.card.suit}
                  {it.card.rank}
                </div>
              )}
            </div>
            <div className={caption} title={it.caption}>
              {it.caption}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function propsEqual(a: PlayHistoryStripProps, b: PlayHistoryStripProps): boolean {
  if (a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    const x = a.items[i];
    const y = b.items[i];
    if (x.id !== y.id || x.caption !== y.caption) return false;
  }
  return true;
}

export const PlayHistoryStrip = memo(PlayHistoryStripImpl, propsEqual);

const strip = css`
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
  min-height: 72px;
  max-width: min(720px, 96%);
  overflow-x: auto;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(201, 162, 39, 0.35);
  scrollbar-width: thin;
  pointer-events: none;
`;

const slot = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  animation: playHistoryIn 0.25s ease-out both;
`;

const cardFace = css`
  min-width: 52px;
  padding: 8px 10px;
  border-radius: 6px;
  background: linear-gradient(135deg, #3a3048 0%, #1e1a28 100%);
  border: 2px solid #c9a227;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55);
  text-align: center;
`;

const cardName = css`
  font-size: 13px;
  font-weight: bold;
  line-height: 1.2;
  white-space: nowrap;
`;

const cardSuit = css`
  font-size: 10px;
  opacity: 0.9;
  margin-top: 1px;
`;

const caption = css`
  font-size: 10px;
  color: #e8d5a3;
  max-width: 72px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
`;
