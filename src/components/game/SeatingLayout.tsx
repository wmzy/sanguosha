import { memo } from 'react';
import { css } from '@linaria/core';
import { colors } from '../../theme';
import { PlayerSeat, type PlayerSeatEntry } from './PlayerSeat';
import type { CardInfo } from '../../../engine/view/types';
import type { TurnPhase } from '../../../shared/types';

interface SeatingLayoutProps {
  ordered: PlayerSeatEntry[];
  cardMap: Record<string, CardInfo>;
  myName: string;
  currentPlayer: string;
  needsTarget: boolean;
  validTargetList: string[];
  selectedTarget: string | null;
  selectedCardId: string | null;
  remainingSeconds: number | null;
  waitingPlayers: Set<string>;
  round: number;
  phase: TurnPhase;
  gameStatus: string;
  deckCount: number;
  discardCount: number;
  isMyTurn: boolean;
  isKillResponse: boolean;
  isAoeResponse: boolean;
  isDyingWindow: boolean;
  getSeatNumber: (name: string) => number;
  getDistance: (from: string, to: string) => number;
  setSelectedTarget: (name: string | null) => void;
  setPerspective: (name: string) => void;
}

const seatRowCenter = css`
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 12px;
`;

const seatRowSpread = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: 1;
  margin-bottom: 12px;
`;

const seatSlot160 = css`
  width: 160px;
`;

const seatCenter = css`
  text-align: center;
  flex: 1;
`;

const metaText = css`
  margin-bottom: 8px;
  font-size: 14px;
  color: ${colors.text.muted};
`;

const metaWait = css`
  color: ${colors.accent.amber};
`;

const metaEnd = css`
  color: ${colors.accent.red};
  font-weight: bold;
`;

const metaDim12 = css`
  font-size: 12px;
  color: ${colors.text.dim};
`;

export const SeatingLayout = memo(function SeatingLayout({
  ordered,
  cardMap,
  myName,
  currentPlayer,
  needsTarget,
  validTargetList,
  selectedTarget,
  selectedCardId,
  remainingSeconds,
  waitingPlayers,
  round,
  phase,
  gameStatus,
  deckCount,
  discardCount,
  isMyTurn,
  isKillResponse,
  isAoeResponse,
  isDyingWindow,
  getSeatNumber,
  getDistance,
  setSelectedTarget,
  setPerspective,
}: SeatingLayoutProps) {
  const bottomPlayer = ordered[0];
  const rightBottomPlayer = ordered[1];
  const rightTopPlayer = ordered[2];
  const leftTopPlayer = ordered[3];
  const leftBottomPlayer = ordered[4];

  const renderSeat = (entry: PlayerSeatEntry | undefined) => {
    if (!entry) return null;
    return (
      <PlayerSeat
        entry={entry}
        cardMap={cardMap}
        myName={myName}
        currentPlayer={currentPlayer}
        needsTarget={needsTarget}
        validTargetList={validTargetList}
        selectedTarget={selectedTarget}
        selectedCardId={selectedCardId}
        remainingSeconds={remainingSeconds}
        isWaiting={waitingPlayers.has(entry.name)}
        getSeatNumber={getSeatNumber}
        getDistance={getDistance}
        setSelectedTarget={setSelectedTarget}
        setPerspective={setPerspective}
      />
    );
  };

  return (
    <>
      <div className={seatRowCenter}>
        {renderSeat(leftTopPlayer)}
        {renderSeat(rightTopPlayer)}
      </div>

      <div className={seatRowSpread}>
        <div className={seatSlot160}>{renderSeat(leftBottomPlayer)}</div>

        <div className={seatCenter}>
          <div className={metaText}>
            回合 {round} | 阶段: {phase} | 当前玩家: {currentPlayer}
          </div>
          <div className={metaText}>
            {!isMyTurn && !isKillResponse && !isAoeResponse && !isDyingWindow && (
              <span className={metaWait}>等待对手...</span>
            )}
            {gameStatus === '已结束' && (
              <span className={metaEnd}>游戏结束</span>
            )}
          </div>
          <div className={metaDim12}>
            弃牌堆: {discardCount} 张 | 牌堆: {deckCount} 张
          </div>
        </div>

        <div className={seatSlot160}>{renderSeat(rightBottomPlayer)}</div>
      </div>

      <div className={seatRowCenter}>{renderSeat(bottomPlayer)}</div>
    </>
  );
});
