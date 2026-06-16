import { css } from '@linaria/core';
import { Link } from 'react-router-dom';
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

export function HomePage() {
  return (
    <div className={page}>
      <h1 className={title}>三国杀</h1>
      <p className={subtitle}>数字卡牌游戏</p>
      <div className={actionList}>
        <Link to="/debug" className={`${linkButtonBase} ${linkOrange}`}>
          调试游戏
        </Link>
      </div>
    </div>
  );
}
