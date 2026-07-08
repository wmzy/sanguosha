/// <reference types="vitest/globals" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const sharedAlias = {
  '@': path.resolve(__dirname, './src/client'),
  '@shared': path.resolve(__dirname, './src/shared'),
  '@engine': path.resolve(__dirname, './src/engine'),
};

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // 默认 node 环境：纯逻辑测试不创建 DOM，省去 jsdom 初始化开销。
    // 需要 DOM 的 UI 测试（React 渲染、testing-library）在文件顶部用
    // `// @vitest-environment jsdom` 注释按需切换（vitest v4 不再支持 environmentMatchGlobs）。
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/', 'dist/', 'tests/',
        '**/*.test.{ts,tsx}', 'scripts/',
        'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts',
      ],
    },
    alias: sharedAlias,

    projects: [
      // 非 skill 测试：node 环境为主，少数 UI 测试文件顶部用 @vitest-environment 注释声明 jsdom。
      // 单 project 单 worker pool，避免多 project 各起 pool 争抢 CPU。
      {
        extends: true,
        test: {
          name: 'core',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/skill-tests/**'],
        },
      },
      // 技能测试：纯逻辑，node 环境，forks 池 + 隔离（避免全局技能注册污染）
      {
        extends: true,
        test: {
          name: 'skills',
          environment: 'node',
          include: ['tests/skill-tests/**/*.test.ts'],
          pool: 'forks',
          isolate: true,
        },
      },
    ],
  },
});
