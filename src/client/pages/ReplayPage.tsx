import { useState } from 'react';
import type { GameLog } from '../../shared/log';
import { loadLog } from '../utils/logFile';
import { ReplayBoard } from '../components/ReplayBoard';
import { colors } from '../theme';

export function ReplayPage() {
  const [log, setLog] = useState<GameLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setError(null);
      const loaded = await loadLog(file);
      setLog(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件加载失败');
    }
  };

  if (log) {
    return <ReplayBoard log={log} onClose={() => setLog(null)} />;
  }

  return (
    <div style={pageStyle}>
      <h2 style={titleStyle}>录像回放</h2>
      <p style={descStyle}>选择一个录像 JSON 文件开始回放</p>
      <label style={uploadBtnStyle}>
        📂 选择录像文件
        <input
          type="file"
          accept=".json"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
      </label>
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  backgroundColor: colors.bg.page,
  color: colors.text.primary,
  gap: 16,
};

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  margin: 0,
};

const descStyle: React.CSSProperties = {
  color: colors.text.secondary,
  fontSize: 14,
};

const uploadBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '12px 24px',
  backgroundColor: colors.accent.blue,
  color: colors.white,
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 15,
};

const errorStyle: React.CSSProperties = {
  color: colors.accent.red,
  fontSize: 13,
};
