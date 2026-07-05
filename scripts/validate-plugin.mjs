// 发布前校验 plugin 结构完整性。
// 用法：node scripts/validate-plugin.mjs
//   - 源文件（plugin.json / SKILL.md / marketplace.json / package.json）：必通过
//   - 构建产物（mcp/）：缺失仅告警，发布前必须跑 pnpm build:plugin
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pluginDir = join(root, 'plugin');
const errors = [];
const warnings = [];

// 1. plugin.json（源文件）
const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
if (!existsSync(manifestPath)) {
  errors.push(`missing: plugin/.claude-plugin/plugin.json`);
} else {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(m.name ?? '')) errors.push('plugin.json: name 不合规（kebab-case）');
  if (!m.version) warnings.push('plugin.json: version 缺失');
  if (!m.mcpServers?.sanguosha) errors.push('plugin.json: mcpServers.sanguosha 缺失');
  console.log(`  plugin: ${m.name}@${m.version ?? '?'}`);
}

// 2. skill（源文件）
const skillPath = join(pluginDir, 'skills', 'sanguosha-play', 'SKILL.md');
if (!existsSync(skillPath)) {
  errors.push(`missing: plugin/skills/sanguosha-play/SKILL.md`);
} else {
  const skill = readFileSync(skillPath, 'utf8');
  if (!skill.startsWith('---')) warnings.push('SKILL.md: 缺少 frontmatter');
  if (!/allowed-tools:.*mcp__sanguosha__play/.test(skill)) warnings.push('SKILL.md: allowed-tools 未声明 sanguosha play 工具');
}

// 3. marketplace.json（源文件）
const marketPath = join(root, '.claude-plugin', 'marketplace.json');
if (!existsSync(marketPath)) {
  errors.push(`missing: .claude-plugin/marketplace.json`);
} else {
  const mk = JSON.parse(readFileSync(marketPath, 'utf8'));
  const entry = mk.plugins?.find(p => p.name === 'sanguosha-play');
  if (!entry) warnings.push('marketplace.json: 无 sanguosha-play 条目');
  else if (!entry.source?.npm?.package) errors.push('marketplace.json: sanguosha-play source 应为 npm 包');
  else if (entry.source.npm.package !== 'sanguosha-agent-plugin')
    errors.push(`marketplace.json: npm 包名应为 sanguosha-agent-plugin，实际 ${entry.source.npm.package}`);
}

// 4. MCP 构建产物（npm 包内容，build 后才有）
const mcpPath = join(pluginDir, 'mcp', 'sanguosha-mcp.mjs');
if (!existsSync(mcpPath)) {
  warnings.push(`plugin/mcp/sanguosha-mcp.mjs 缺失（构建产物，跑 pnpm build:plugin 生成；发布前必须存在）`);
} else {
  const head = readFileSync(mcpPath, 'utf8').slice(0, 30);
  if (!head.startsWith('#!/usr/bin/env node')) errors.push('plugin/mcp/sanguosha-mcp.mjs: 缺少 shebang');
  console.log(`  mcp: ${(statSync(mcpPath).size / 1024).toFixed(0)}KB`);
}

// 5. plugin/package.json（npm 包元数据，源文件，version 由 semantic-release 管理）
const pkgPath = join(pluginDir, 'package.json');
if (!existsSync(pkgPath)) {
  errors.push(`missing: plugin/package.json（npm 包元数据，源文件）`);
} else {
  const p = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (p.name !== 'sanguosha-agent-plugin') errors.push(`plugin/package.json: name 应为 sanguosha-agent-plugin`);
  if (!p.files?.includes('mcp/')) errors.push('plugin/package.json: files 未包含 mcp/');
  console.log(`  npm:  ${p.name}@${p.version}`);
}

if (errors.length) {
  console.error('\n✗ plugin 校验失败:');
  errors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}
warnings.forEach(w => console.warn(`  ! ${w}`));
console.log('\n✓ plugin 结构校验通过');
