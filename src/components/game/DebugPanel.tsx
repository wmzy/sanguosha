import { memo } from 'react';
import { css, cx } from '@linaria/core';
import { colors, styles } from '../../theme';
import type { GameState } from '../../../engine/types';

interface DebugPanelProps {
  state: GameState;
  myName: string;
  onToggleAutoSkipWuxie: () => void;
}

const debugDetails = css`
  margin-top: 16px;
  background-color: ${colors.bg.nav};
  border-radius: 8px;
  padding: 12px;
`;

const debugSummary = css`
  cursor: pointer;
  color: ${colors.accent.amber};
  font-size: 14px;
  font-weight: bold;
`;

const debugBody = css`
  margin-top: 12px;
`;

const debugStatText = css`
  font-size: 12px;
  color: ${colors.text.muted};
  margin-bottom: 8px;
`;

const debugPlayerRow = css`
  margin-bottom: 8px;
  padding: 8px;
  background-color: ${colors.bg.page};
  border-radius: 4px;
`;

const debugPlayerName = css`
  font-size: 13px;
  font-weight: bold;
  margin-bottom: 4px;
`;

const debugPlayerNameMe = css`
  color: ${colors.accent.blue};
`;

const debugPlayerNameOther = css`
  color: ${colors.text.secondary};
`;

const debugPlayerDead = css`
  color: ${colors.accent.red};
`;

const debugCardPill = css`
  font-size: 11px;
  padding: 2px 6px;
  background-color: ${colors.bg.panel};
  border-radius: 4px;
  color: ${colors.text.input};
`;

const debugCardList = css`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
`;

const debugEmptyHand = css`
  font-size: 11px;
  color: ${colors.text.dim};
`;

const debugEquipLine = css`
  font-size: 11px;
  color: ${colors.accent.amber};
  margin-top: 4px;
`;

const debugAutoSkipPadding = css`
  font-size: 12px;
  margin-bottom: 12px;
`;

export const DebugPanel = memo(({
  state,
  myName,
  onToggleAutoSkipWuxie,
}: DebugPanelProps) => {
  return (
    <details className={debugDetails}>
      <summary className={debugSummary}>调试信息（点击展开）</summary>
      <div className={debugBody}>
        <div className={debugStatText}>
          牌堆: {state.zones.deck.length} 张 | 弃牌堆: {state.zones.discardPile.length} 张
        </div>
        <button
          onClick={onToggleAutoSkipWuxie}
          className={debugAutoSkipPadding}
          style={styles.btn(state.meta.autoSkipWuxie ? colors.accent.green : colors.accent.red)}
        >
          自动跳过无懈可击: {state.meta.autoSkipWuxie ? '开' : '关'}
        </button>
        {state.playerOrder.map((name) => {
          const player = state.players[name];
          return (
            <div key={name} className={debugPlayerRow}>
              <div
                className={cx(
                  debugPlayerName,
                  name === myName ? debugPlayerNameMe : debugPlayerNameOther,
                )}
              >
                {name} ({player.info.characterId}) - {player.health}/{player.maxHealth} HP
                {!player.info.alive && <span className={debugPlayerDead}> [阵亡]</span>}
              </div>
              <div className={debugCardList}>
                {player.hand.map((cardId) => {
                  const card = state.cardMap[cardId];
                  if (!card) return null;
                  return (
                    <span key={cardId} className={debugCardPill}>
                      {card.name}
                      {card.suit}
                      {card.rank}
                    </span>
                  );
                })}
                {player.hand.length === 0 && (
                  <span className={debugEmptyHand}>无手牌</span>
                )}
              </div>
              {Object.values(player.equipment).some(Boolean) && (
                <div className={debugEquipLine}>
                  装备: {player.equipment.武器 && state.cardMap[player.equipment.武器]?.name}{' '}
                  {player.equipment.防具 && state.cardMap[player.equipment.防具]?.name}{' '}
                  {player.equipment.防御马 && state.cardMap[player.equipment.防御马]?.name}{' '}
                  {player.equipment.进攻马 &&
                    state.cardMap[player.equipment.进攻马]?.name}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
});
