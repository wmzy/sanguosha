import { css } from '@linaria/core';
import { Link, useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import { colors } from '../theme';
import { loadReplay } from '../replay/replayFile';
import type { ReplayFile } from '../replay/types';

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

const linkGray = css`
  background-color: ${colors.disabled};
`;

const linkBlue = css`
  background-color: ${colors.accent.blue};
`;

export function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoadReplay = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const replay: ReplayFile = await loadReplay(file);
      navigate('/replay', { state: { file: replay } });
    } catch (err) {
      alert(`加载录像失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 清空 input,允许重复选同一文件
    e.target.value = '';
  };

  return (
    <div className={page}>
      <h1 className={title}>三国杀</h1>
      <p className={subtitle}>数字卡牌游戏</p>
      <div className={actionList}>
        <Link to="/play" className={`${linkButtonBase} ${linkBlue}`}>
          多人游戏
        </Link>
        <Link to="/debug" className={`${linkButtonBase} ${linkOrange}`}>
          调试游戏
        </Link>
        <button className={`${linkButtonBase} ${linkGray}`} onClick={handleLoadReplay}>
          📂 加载录像回放
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
