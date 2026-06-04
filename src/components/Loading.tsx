import { css } from '@linaria/core';
import { colors } from '../theme';

const rootBox = css`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background-color: ${colors.bg.page};
  color: ${colors.text.muted};
`;

const spinnerRing = css`
  width: 48px;
  height: 48px;
  border: 4px solid ${colors.bg.input};
  border-top-color: ${colors.accent.blue};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const label = css`
  font-size: 14px;
  letter-spacing: 2px;
`;

export function Loading() {
  return (
    <div className={rootBox} role="status" aria-live="polite">
      <div className={spinnerRing} />
      <span className={label}>加载中…</span>
    </div>
  );
}
