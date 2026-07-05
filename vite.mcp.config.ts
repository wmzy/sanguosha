// MCP server 单文件打包配置（与前端 vite.config.ts 分离）。
// 产出 dist/sanguosha-mcp/sanguosha-mcp.mjs：带 shebang、可 `node` 直接运行。
// 被 scripts/build-plugin.mjs 复用：SGS_PUBLIC_URL=wss://<公开服务器>/ws pnpm build:plugin 注入默认服务器地址并打包进 npm 包。
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __SGS_DEFAULT_URL__: JSON.stringify(process.env.SGS_PUBLIC_URL ?? ''),
  },
  build: {
    lib: {
      entry: 'src/ai-mcp/server.ts',
      formats: ['es'],
      fileName: () => 'sanguosha-mcp.mjs',
    },
    outDir: 'dist/sanguosha-mcp',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'node22',
    rollupOptions: {
      // node 内置模块外置；ws 的可选原生加速模块外置（缺失时 ws 自动回退纯 JS）
      external: [/^node:/, 'bufferutil', 'utf-8-validate'],
      output: {
        banner: '#!/usr/bin/env node',
        // 引擎用动态 import() 懒加载技能/卡牌，默认会被 Rollup 拆成多个 chunk。
        // codeSplitting:false 把它们全部内联进单文件，满足「单文件发布」目标。
        codeSplitting: false,
      },
    },
  },
});
