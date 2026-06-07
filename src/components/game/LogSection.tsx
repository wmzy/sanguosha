import { memo } from 'react';
import { css } from '@linaria/core';
import { colors, styles } from '../../theme';
import { LogPanel } from '../LogPanel';
import type { Operation } from '../../../shared/log';

interface LogSectionProps {
  operations: Operation[];
  onSaveLog: () => void;
}

const bottomButtonsRow = css`
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 12px;
`;

export const LogSection = memo(({
  operations,
  onSaveLog,
}: LogSectionProps) => {
  return (
    <>
      <div className={bottomButtonsRow}>
        <button onClick={onSaveLog} style={styles.smallBtn(colors.accent.purpleLight)}>
          保存日志
        </button>
      </div>
      <LogPanel operations={operations} maxHeight={150} />
    </>
  );
});
