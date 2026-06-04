// src/components/game/PlayerSeat.tsx — 玩家座位（带点击选择/双击切视角）
//
// PlayerPanel 的薄包装：根据 needsTarget / validTargetList 决定当前座位是否可被点击选为目标，
// 同时支持双击切换视角。被选中目标时显示红色 outline。

import { memo } from 'react';
import { css, cx } from '@linaria/core';
import { PlayerPanel, type PlayerPanelData } from '../PlayerPanel';
import { colors } from '../../theme';
import type { CardInfo } from '../../../engine/view/types';
import type { AbilityConfig } from '../../../shared/types';

export interface PlayerSeatEntry {
  name: string;
  panelData: PlayerPanelData;
  role: string;
  alive: boolean;
  abilities?: AbilityConfig[];
}

interface PlayerSeatProps {
  entry: PlayerSeatEntry;
  cardMap: Record<string, CardInfo>;
  myName: string;
  currentPlayer: string;
  needsTarget: boolean;
  validTargetList: string[];
  selectedTarget: string | null;
  selectedCardId: string | null;
  remainingSeconds: number | null;
  isWaiting: boolean;
  getSeatNumber: (name: string) => number;
  getDistance: (from: string, to: string) => number;
  setSelectedTarget: (name: string | null) => void;
  setPerspective: (name: string) => void;
}

const playerPanelWrap = css`
  border-radius: 12px;
  transition: outline 0.2s;
  cursor: default;
  opacity: 1;
`;

const playerPanelWrapClickable = css`
  cursor: pointer;
`;

const playerPanelWrapDim = css`
  opacity: 0.5;
`;

export const PlayerSeat = memo(function PlayerSeat({
  entry,
  cardMap,
  myName,
  currentPlayer,
  needsTarget,
  validTargetList,
  selectedTarget,
  selectedCardId,
  remainingSeconds,
  isWaiting,
  getSeatNumber,
  getDistance,
  setSelectedTarget,
  setPerspective,
}: PlayerSeatProps) {
  const { name, panelData, role, alive, abilities } = entry;

  const clickable =
    needsTarget && name !== myName && alive && validTargetList.includes(name);
  const dimmed = needsTarget && !validTargetList.includes(name) && name !== myName;
  const wrapClass = cx(
    playerPanelWrap,
    clickable && playerPanelWrapClickable,
    dimmed && playerPanelWrapDim,
  );

  return (
    <div
      onClick={() => {
        if (clickable) {
          setSelectedTarget(name === selectedTarget ? null : name);
        }
      }}
      onDoubleClick={() => setPerspective(name)}
      className={wrapClass}
      style={
        selectedTarget === name
          ? { outline: `3px solid ${colors.accent.red}` }
          : undefined
      }
    >
      <PlayerPanel
        playerName={name}
        data={panelData}
        cardMap={cardMap}
        isCurrentPlayer={name === currentPlayer}
        isSelf={name === myName}
        role={panelData.kind === 'self' ? role : undefined}
        seatNumber={getSeatNumber(name)}
        distance={
          selectedCardId !== null && name !== myName ? getDistance(myName, name) : undefined
        }
        timerSeconds={isWaiting && remainingSeconds !== null ? remainingSeconds : undefined}
        abilities={abilities}
      />
    </div>
  );
});
