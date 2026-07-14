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
    // 全局关闭文件级隔离:引擎模块级状态已全部改为 state-bound(WeakMap),
    // DOM 清理由 setup.ts 全局注册的 afterEach(cleanup) 负责,
    // 所有文件共享 worker context + 模块缓存,显著减少重复 import 开销。
    isolate: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/', 'dist/', 'tests/',
        '**/*.test.{ts,tsx}', 'scripts/',
        'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts',
      ],
      // 覆盖率基线阈值:基于 2026-07-15 全量覆盖率快照设定,防止退化。
      // 当前实际: Stmts 79.12% / Branch 65.71% / Funcs 78.19% / Lines 87.3%
      // 阈值留 ~1% 安全余量,允许小范围波动不误报 CI。
      // 提升覆盖率后请同步上调此阈值(只升不降)。
      thresholds: {
        statements: 78,
        branches: 64,
        functions: 77,
        lines: 86,
      },
    },
    alias: sharedAlias,

    projects: [
      // 非 skill 测试：node 环境为主，少数 UI 测试文件顶部用 @vitest-environment 注释声明 jsdom。
      {
        extends: true,
        test: {
          name: 'core',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/skill-tests/**'],
        },
      },
      // 技能测试：纯逻辑,node 环境,与 core 共享全局 isolate:false。
      {
        extends: true,
        test: {
          name: 'skills',
          include: ['tests/skill-tests/**/*.test.ts'],
        },
      },
    ],
  },
});
