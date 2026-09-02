// tests/e2e/auth.setup.ts — 全局认证 setup。
// 移除游客模式后(177ca5f2),/play 与 /debug 都在 RequireAuth 之后;
// 此处在跑任何业务用例前注册一次性账号,把 HttpOnly 会话 Cookie 存入
// storageState(playwright.config 的 chromium 项目经 dependencies 复用),
// 避免每个用例各自注册撞认证限流(30 req/min/IP)。
import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_FILE = path.resolve(process.cwd(), 'test-results/.auth/user.json');

setup('注册 e2e 专用账号并保存会话', async ({ request }) => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  expect(fs.existsSync(path.dirname(AUTH_FILE))).toBe(true);
  const username = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await request.post('/api/auth/register', {
    data: { username, password: 'e2e-pass-123' },
  });
  expect(res.status()).toBe(200);
  // 把响应里的会话 Cookie 持久化(chromium 项目所有用例共享登录态)
  await request.storageState({ path: AUTH_FILE });
  expect(fs.existsSync(AUTH_FILE)).toBe(true);
});
