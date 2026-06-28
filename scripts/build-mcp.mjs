// 构建 sanguosha-mcp 发布包：vite 单文件打包 + 生成 package.json/README。
// 用法：
//   pnpm build:mcp                                  # 默认 0.1.0，无公开服务器默认值
//   MCP_VERSION=0.2.0 SGS_PUBLIC_URL=wss://x/ws pnpm build:mcp
// 产物：dist/sanguosha-mcp/（sanguosha-mcp.mjs + package.json + README.md）
// 发布：npm publish dist/sanguosha-mcp
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = 'dist/sanguosha-mcp';
const version = process.env.MCP_VERSION ?? '0.1.0';
const publicUrl = process.env.SGS_PUBLIC_URL ?? '';

console.log(`building sanguosha-mcp@${version}${publicUrl ? ` (default server: ${publicUrl})` : ''}`);

await build({ configFile: 'vite.mcp.config.ts' });

await mkdir(outDir, { recursive: true });

const pkg = {
  name: 'sanguosha-mcp',
  version,
  description: '三国杀 AI 代打 MCP server——把游戏引擎暴露给通用 agent 驱动对局',
  type: 'module',
  bin: { 'sanguosha-mcp': './sanguosha-mcp.mjs' },
  engines: { node: '>=22' },
  license: 'MIT',
  homepage: 'https://github.com/wmzy/sanguosha',
};
await writeFile(join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

const defaultUrlDisplay = publicUrl || 'wss://<公开服务器>/ws';
const readme = `# sanguosha-mcp

三国杀 AI 代打 MCP server。一个进程接管一个座次视角，通过 stdio JSON-RPC 暴露给通用 agent（Claude Code / Cursor / Codex / Windsurf 等）。

## 快速接入（Claude Code）

\`\`\`bash
claude mcp add sanguosha -- env SGS_SERVER_URL=${defaultUrlDisplay} npx -y sanguosha-mcp
\`\`\`

或写入项目 \`.mcp.json\`：

\`\`\`json
{
  "mcpServers": {
    "sanguosha": {
      "command": "npx",
      "args": ["-y", "sanguosha-mcp"],
      "env": { "SGS_SERVER_URL": "${defaultUrlDisplay}" }
    }
  }
}
\`\`\`

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| \`SGS_SERVER_URL\` | ${publicUrl ? `\`${publicUrl}\`` : '注入值/localhost'} | 游戏服务器 WS 地址（注意 /ws 路径） |
| \`SGS_ROOM_ID\` | 自动建房 | 加入指定房间 |
| \`SGS_SEAT\` | \`0\` | 座次下标 |
| \`SGS_PLAYER_COUNT\` | \`2\` | 建房人数 |

完整文档与玩家向 skill：https://github.com/wmzy/sanguosha#ai-agent-接入
`;
await writeFile(join(outDir, 'README.md'), readme);

console.log(`✓ built → ${outDir}/`);
