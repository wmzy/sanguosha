// src/client/components/RequireAuth.tsx — 登录门禁。
// 游客模式已移除:进入多人/调试页需登录(会话 Cookie)。
// 未登录时内嵌 AuthPanel(登录/注册/GitHub);登录成功后渲染子页面。
// 调试页同样要求登录(开发流程统一走账号),但调试房内座次身份仍按旧模型
// (每座次独立 playerId,见 useDebugMultiConnection)。
import { type ReactNode } from 'react';
import { css } from '@linaria/core';
import { colors, pageStyle } from '../theme';
import { AuthPanel } from './AuthPanel';
import { useAuth } from '../hooks/useAuth';

// 注意:wyw-in-js 下 css`` 内插值其他 css 类(如 ${pageStyle})不会内联其属性,
// 必须在使用处做 className 字符串组合,否则 padding/flex 全部丢失(面板贴左上角)。
const overlay = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
`;

const card = css`
  background-color: ${colors.bg.panel};
  border-radius: 12px;
  padding: 32px;
  width: 100%;
  max-width: 380px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  text-align: center;
`;

const heading = css`
  font-size: 22px;
  margin: 0 0 8px;
  color: ${colors.accent.gold};
  letter-spacing: 2px;
`;

const hint = css`
  font-size: 13px;
  color: ${colors.text.muted};
  margin: 0 0 24px;
  line-height: 1.5;
`;

/**
 * 登录门禁:已登录渲染 children;未登录显示登录/注册面板。
 * loading 期间(/me 探测)显示占位,防止已登录用户闪登录页。
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.loading) return null;
  if (auth.user) return <>{children}</>;
  return (
    <div className={`${pageStyle} ${overlay}`}>
      <div className={card}>
        <h3 className={heading}>请先登录</h3>
        <p className={hint}>进入房间前需要登录账号。没有账号？注册只需用户名和密码。</p>
        <AuthPanel auth={auth} compact />
      </div>
    </div>
  );
}
