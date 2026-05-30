import type { CSSProperties } from 'react';

export const colors = {
  bg: {
    page: '#1a1a2e',
    panel: '#2c3e50',
    input: '#34495e',
    nav: '#16213e',
    playerSelf: '#2c3e50',
    playerOther: '#1a252f',
  },
  text: {
    primary: '#eee',
    secondary: '#bdc3c7',
    muted: '#95a5a6',
    dim: '#7f8c8d',
    input: '#ecf0f1',
  },
  accent: {
    red: '#e74c3c',
    darkRed: '#c0392b',
    green: '#2ecc71',
    greenDark: '#27ae60',
    blue: '#3498db',
    orange: '#e67e22',
    amber: '#f39c12',
    gold: '#f1c40f',
    purple: '#8e44ad',
    purpleLight: '#9b59b6',
  },
  card: {
    playable: '#2c3e50',
    selected: '#34495e',
    discardSelected: '#4a235a',
    borderPlayable: '#555',
    borderSelected: '#e74c3c',
    borderDiscard: '#8e44ad',
    borderDefault: '#333',
  },
  disabled: '#555',
  white: 'white',
  overlay: 'rgba(0,0,0,0.8)',
} as const;

export const styles = {
  page: (padding = 20): CSSProperties => ({
    padding,
    backgroundColor: colors.bg.page,
    minHeight: '100vh',
    color: colors.text.primary,
  }),

  btn: (bg: string, opts?: { padding?: string; fontSize?: number; cursor?: string }): CSSProperties => ({
    padding: opts?.padding ?? '8px 24px',
    backgroundColor: bg,
    color: colors.white,
    border: 'none',
    borderRadius: 6,
    cursor: opts?.cursor ?? 'pointer',
    fontSize: opts?.fontSize ?? 14,
    fontWeight: 'bold',
  }),

  smallBtn: (bg: string): CSSProperties => ({
    padding: '4px 12px',
    backgroundColor: bg,
    color: colors.white,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  }),

  flexCenter: (gap = 12): CSSProperties => ({
    display: 'flex',
    justifyContent: 'center',
    gap,
    marginBottom: gap,
  }),

  input: (): CSSProperties => ({
    width: '100%',
    padding: '10px 12px',
    backgroundColor: colors.bg.input,
    border: 'none',
    borderRadius: 6,
    color: colors.white,
    fontSize: 14,
  }),

  errorToast: (): CSSProperties => ({
    position: 'fixed',
    top: 20,
    right: 20,
    backgroundColor: colors.accent.red,
    padding: '15px 25px',
    borderRadius: 8,
    zIndex: 1000,
  }),

  logContainer: (): CSSProperties => ({
    maxHeight: 200,
    overflow: 'auto',
    backgroundColor: colors.bg.panel,
    borderRadius: 8,
    padding: 12,
  }),

  card: (opts: { selected?: boolean; playable?: boolean; discardMode?: boolean }): CSSProperties => {
    const { selected, playable, discardMode } = opts;
    let border: string = colors.card.borderDefault;
    let bg: string = colors.bg.page;
    if (selected) {
      border = discardMode ? colors.card.borderDiscard : colors.card.borderSelected;
      bg = discardMode ? colors.card.discardSelected : colors.card.selected;
    } else if (playable) {
      border = colors.card.borderPlayable;
      bg = colors.card.playable;
    }
    return {
      border: `2px solid ${border}`,
      backgroundColor: bg,
      borderRadius: 8,
      padding: 8,
      cursor: playable ? 'pointer' : 'default',
    };
  },
};
