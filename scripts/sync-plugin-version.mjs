// semantic-release prepare 阶段调用:把 nextRelease.version 写入 plugin.json，
// 使 Claude Code plugin list/update 能正确识别版本号。
// 用法: node scripts/sync-plugin-version.mjs <version>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('用法: node sync-plugin-version.mjs <version>');
  process.exit(1);
}

const pluginJsonPath = resolve('plugin/.claude-plugin/plugin.json');
const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
pluginJson.version = version;
writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2) + '\n');
console.log(`✓ plugin.json version → ${version}`);
