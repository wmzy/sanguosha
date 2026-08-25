import { defineConfig, devices } from '@playwright/test';

const AUTH_FILE = 'test-results/.auth/user.json';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // e2e 是真实浏览器+服务端交互:高并发下 SSE 连接/CPU 竞争会放大开局时序竞态;
  // 且调试组用例虽各自持有独立账号,仍共享同一 dev server(PGlite)。
  workers: 2,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3930',
    trace: 'on-first-retry',
    // 全套件共享登录态:移除游客模式后,/play 与 /debug 均在 RequireAuth 之后,
    // 由 auth.setup.ts 注册一次性账号并把会话 Cookie 存入 storageState。
    storageState: AUTH_FILE,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      // 显式空 state:undefined 不算覆盖,会继承顶层 storageState,
      // 导致 request fixture 初始化时去读尚未生成的 AUTH_FILE 而 ENOENT。
      use: { storageState: { cookies: [], origins: [] } },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3930',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
