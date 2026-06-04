import { css } from '@linaria/core';
import { Link } from 'react-router-dom';
import { useCallback, useState } from 'react';
import { ReplayBoard } from '../components/ReplayBoard';
import { loadState } from '../utils/logFile';
import type { GameState } from '../../engine/types';
import { colors } from '../theme';

const page = css`
  min-height: 100vh;
  background-color: ${colors.bg.page};
  display: flex;
  flex-direction: column;
  align-items: center;
  color: ${colors.text.primary};
  padding: 60px 20px 40px;
`;

const title = css`
  font-size: 48px;
  margin: 0 0 8px;
  letter-spacing: 4px;
`;

const subtitle = css`
  color: ${colors.text.muted};
  margin: 0 0 40px;
`;

const actionList = css`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 280px;
`;

const linkButtonBase = css`
  display: block;
  padding: 14px 24px;
  color: ${colors.white};
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  text-align: center;
  text-decoration: none;
`;

const linkOrange = css`
  background-color: ${colors.accent.orange};
`;

const linkBlue = css`
  background-color: ${colors.accent.blue};
`;

const buttonPurple = css`
  background-color: ${colors.accent.purpleLight};
  width: 100%;
`;

export function HomePage() {
  const [replayState, setReplayState] = useState<GameState | null>(null);

  const handleLoadLog = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const data = await loadState(file);
          setReplayState(data);
        } catch {
          alert('无效的日志文件');
        }
      }
    };
    input.click();
  }, []);

  if (replayState) {
    return <ReplayBoard onExit={() => setReplayState(null)} />;
  }

  return (
    <div className={page}>
      <h1 className={title}>三国杀</h1>
      <p className={subtitle}>数字卡牌游戏</p>

      <div className={actionList}>
        <Link to="/debug" className={`${linkButtonBase} ${linkOrange}`}>
          调试游戏
        </Link>
        <Link to="/lobby" className={`${linkButtonBase} ${linkBlue}`}>
          多人对战
        </Link>
        <button type="button" onClick={handleLoadLog} className={`${linkButtonBase} ${buttonPurple}`}>
          回放
        </button>
      </div>
    </div>
  );
}
