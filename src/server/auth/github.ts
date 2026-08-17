// src/server/auth/github.ts — GitHub OAuth(纯函数模块,无模块级可变状态)。
// 标准授权码流程:authorize 跳转 → callback 换 token → 拉用户信息。
// 凭据经环境变量注入(GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET);未配置时路由层禁用入口。
// access token 只在服务端使用,不下发客户端。
import { createLogger } from '../logger';

const log = createLogger('github-oauth');

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
}

/** 从环境变量读取 GitHub OAuth 凭据;未配置返回 null。 */
export function getGithubConfig(): GithubConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isGithubEnabled(): boolean {
  return getGithubConfig() !== null;
}

/** 生成 state(防 CSRF):32 字节随机 hex。 */
export function generateState(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

export interface GithubProfile {
  githubId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** 授权码 → access token → 用户资料。失败抛 Error(含原因)。 */
export async function exchangeCodeForProfile(
  code: string,
  config: GithubConfig,
  redirectUri: string,
): Promise<GithubProfile> {
  // 1. 换 access token
  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResp.ok) {
    throw new Error(`GitHub token 交换失败: HTTP ${tokenResp.status}`);
  }
  const tokenBody = (await tokenResp.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenBody.access_token) {
    throw new Error(`GitHub token 交换失败: ${tokenBody.error_description ?? tokenBody.error ?? '未知错误'}`);
  }

  // 2. 拉用户资料
  const userResp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'sanguosha-server',
    },
  });
  if (!userResp.ok) {
    throw new Error(`GitHub 用户信息获取失败: HTTP ${userResp.status}`);
  }
  const u = (await userResp.json()) as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string | null;
  };
  if (typeof u.id !== 'number' || typeof u.login !== 'string') {
    throw new Error('GitHub 用户信息格式异常');
  }
  log.info('GitHub 登录成功', { login: u.login });
  return {
    githubId: String(u.id),
    username: u.login,
    displayName: u.name ?? u.login,
    avatarUrl: u.avatar_url ?? null,
  };
}
