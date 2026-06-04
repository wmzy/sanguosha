import { memo } from 'react';
import { css } from '@linaria/core';
import { colors, styles } from '../../theme';

interface GameHeaderProps {
  myName: string;
  onSwitchPerspective: () => void;
  onGoToCurrentPlayer: () => void;
  hideGoToCurrentPlayer: boolean;
}

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`;

const headerLeft = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const titleText = css`
  margin: 0;
  font-size: 20px;
`;

export const GameHeader = memo(function GameHeader({
  myName,
  onSwitchPerspective,
  onGoToCurrentPlayer,
  hideGoToCurrentPlayer,
}: GameHeaderProps) {
  return (
    <div className={headerRow}>
      <div className={headerLeft}>
        <h1 className={titleText}>三国杀</h1>
        <button onClick={onSwitchPerspective} style={styles.smallBtn(colors.accent.blue)}>
          切换视角 ({myName})
        </button>
        {!hideGoToCurrentPlayer && (
          <button onClick={onGoToCurrentPlayer} style={styles.smallBtn(colors.accent.green)}>
            查看活跃玩家
          </button>
        )}
      </div>
    </div>
  );
});
