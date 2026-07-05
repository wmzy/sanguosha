// 构建 plugin 的 MCP 产物：复用 vite 单文件打包，输出到 plugin/mcp/。
// plugin/package.json 是源文件（进 git），本脚本不生成它——版本号由 semantic-release 在 CI 管理。
// 用法：SGS_PUBLIC_URL=wss://<公开服务器>/ws pnpm build:plugin
// 产物：plugin/mcp/sanguosha-mcp.mjs（带 shebang，.gitignore，只进 npm tarball）
import { build } from 'vite';
import { mkdir, copyFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';

const mcpDir = 'plugin/mcp';
const publicUrl = process.env.SGS_PUBLIC_URL ?? '';

console.log(`building plugin MCP${publicUrl ? ` (default server: ${publicUrl})` : ''}`);

// 1. vite 单文件打包 MCP → dist/sanguosha-mcp/
await build({ configFile: 'vite.mcp.config.ts' });

// 2. 复制产物到 plugin/mcp/（每次重建，避免残留旧版）
await rm(mcpDir, { recursive: true, force: true });
await mkdir(mcpDir, { recursive: true });
await copyFile('dist/sanguosha-mcp/sanguosha-mcp.mjs', join(mcpDir, 'sanguosha-mcp.mjs'));
await chmod(join(mcpDir, 'sanguosha-mcp.mjs'), 0o755);
console.log(`✓ built → ${mcpDir}/sanguosha-mcp.mjs`);
