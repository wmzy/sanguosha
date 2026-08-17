import { css } from '@linaria/core';
import { Link, useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';
import { colors, btnStyle, pageBgStyle, glassPanelStyle, goldColors, shadows } from '../theme';
import { loadReplay } from '../replay/replayFile';
import type { ReplayFile } from '../replay/types';
import { getPlayerId, setPlayerId } from '../utils/playerIdentity';
import { PlayerIdForm } from '../components/RequirePlayerId';
import { AuthPanel } from '../components/AuthPanel';
import { useAuth } from '../hooks/useAuth';

// ─── 首页视觉:深色牌匾质感 + 金色书法标题 + 卡片式入口 ───

const page = css`
  ${pageBgStyle}
  background-color: #0d1220;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: ${colors.text.primary};
  padding: 72px 20px 48px;
  position: relative;
  overflow: hidden;

  /* 纯 CSS 装饰:标题背后的低透明度大圆纹理(牌匾光晕 + 描线圆环) */
  &::before {
    content: '';
    position: absolute;
    top: -320px;
    left: 50%;
    transform: translateX(-50%);
    width: 820px;
    height: 820px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(241, 196, 15, 0.07) 0%, transparent 68%);
    pointer-events: none;
    z-index: -1;
  }

  &::after {
    content: '';
    position: absolute;
    top: -200px;
    left: 50%;
    transform: translateX(-50%);
    width: 560px;
    height: 560px;
    border-radius: 50%;
    border: 1px solid rgba(241, 196, 15, 0.1);
    box-shadow: 0 0 0 60px rgba(241, 196, 15, 0.025);
    pointer-events: none;
    z-index: -1;
  }
`;

/** 标题:书法/牌匾质感 —— 大号 serif + 金色文字渐变 + 拉开字距 */
const title = css`
  margin: 0 0 14px;
  font-family: 'Noto Serif SC', 'STKaiti', 'KaiTi', 'SimSun', serif;
  font-size: 76px;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: 18px;
  text-indent: 18px; /* 平衡末字字距造成的视觉偏移 */
  background-image: linear-gradient(
    180deg,
    ${goldColors.light} 0%,
    ${goldColors.base} 55%,
    ${goldColors.soft} 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.55));
`;

const subtitle = css`
  color: ${goldColors.soft};
  font-size: 15px;
  letter-spacing: 6px;
  text-indent: 6px;
  margin: 0 0 10px;
`;

const actionList = css`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 360px;
  max-width: 100%;
  margin-top: 36px;
`;

/** 入口卡片基座:hover 抬升 + 边框亮起 */
const linkButtonBase = css`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  color: ${colors.text.primary};
  border: 1px solid rgba(241, 196, 15, 0.18);
  border-radius: 12px;
  background-color: rgba(28, 36, 58, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  text-align: left;
  text-decoration: none;
  font-family: inherit;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background-color 0.18s ease;

  &:hover {
    transform: translateY(-3px);
    border-color: rgba(241, 196, 15, 0.55);
    background-color: rgba(38, 48, 74, 0.6);
    box-shadow: ${shadows.raise}, ${shadows.glow};
  }

  &:active {
    transform: translateY(-1px);
  }
`;

/** 卡片左侧 icon 槽位 */
const linkIcon = css`
  flex-shrink: 0;
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  line-height: 1;
  border-radius: 10px;
  background-color: rgba(241, 196, 15, 0.1);
  border: 1px solid rgba(241, 196, 15, 0.22);
`;

/** icon 色彩变体:蓝(多人)/橙(调试)/灰(录像) */
const linkBlue = css`
  color: #85c1f5;
`;

const linkOrange = css`
  color: ${colors.accent.orange};
`;

const linkGray = css`
  color: ${colors.text.secondary};
`;

const linkTexts = css`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
`;

const linkTitle = css`
  font-size: 16px;
  color: ${goldColors.light};
`;

const linkDesc = css`
  font-size: 12px;
  font-weight: normal;
  color: ${colors.text.secondary};
`;

const identityBar = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  color: ${colors.text.secondary};
`;

const identityName = css`
  color: ${goldColors.base};
  font-weight: bold;
`;

const changeBtn = css`
  ${btnStyle}
  --btn-bg: rgba(52, 73, 94, 0.85);
  --btn-padding: 4px 12px;
  --btn-font-size: 12px;
`;

const identityCard = css`
  ${glassPanelStyle}
  padding: 28px;
  width: 100%;
  max-width: 360px;
  text-align: center;
`;

const identityHeading = css`
  font-size: 18px;
  margin: 0 0 16px;
  color: ${goldColors.base};
`;

export function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pid, setPid] = useState<string | null>(() => getPlayerId());
  const [editing, setEditing] = useState(false);
  const auth = useAuth();
  // GitHub 回调 redirect 回 /?authError=xxx 时提示错误
  const [oauthError] = useState<string | null>(() => {
    const m = window.location.search.match(/[?&]authError=([\w-]+)/);
    return m ? m[1] : null;
  });

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
      {oauthError && (
        <div className={identityBar} role="alert">
          <span>登录失败（{oauthError}），请重试</span>
        </div>
      )}
      <div className={identityCard}>
        <h3 className={identityHeading}>{auth.user ? '账号' : '登录 / 注册'}</h3>
        <AuthPanel auth={auth} />
      </div>
      <div className={identityBar}>
        <span>当前身份：</span>
        {pid ? (
          <>
            <span className={identityName}>{pid}</span>
            <button className={changeBtn} onClick={() => setEditing(true)}>
            修改
            </button>
          </>
        ) : (
          <button className={changeBtn} onClick={() => setEditing(true)}>
          设置身份
          </button>
        )}
      </div>
      {editing && (
        <div className={identityCard}>
          <h3 className={identityHeading}>修改身份</h3>
          <PlayerIdForm
            initial={pid ?? ''}
            submitLabel="保存"
            onSet={(id) => {
              setPlayerId(id);
              setPid(id);
              setEditing(false);
            }}
          />
        </div>
      )}
      <div className={actionList}>
        <Link to="/play" className={linkButtonBase}>
          <span className={`${linkIcon} ${linkBlue}`}>⚔</span>
          <span className={linkTexts}>
            <span className={linkTitle}>多人游戏</span>
            <span className={linkDesc}>创建或加入房间，与好友在线对局</span>
          </span>
        </Link>
        <Link to="/debug" className={linkButtonBase}>
          <span className={`${linkIcon} ${linkOrange}`}>🛠</span>
          <span className={linkTexts}>
            <span className={linkTitle}>调试游戏</span>
            <span className={linkDesc}>本地调试房间，验证技能与流程</span>
          </span>
        </Link>
        <button className={linkButtonBase} onClick={handleLoadReplay}>
          <span className={`${linkIcon} ${linkGray}`}>📂</span>
          <span className={linkTexts}>
            <span className={linkTitle}>录像回放</span>
            <span className={linkDesc}>加载对局录像文件，回顾整场战斗</span>
          </span>
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
