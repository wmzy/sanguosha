// Integration check against a running pnpm dev: a separate stdio MCP process plays
// alongside an in-process headless player, using the generated per-seat config.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runArena, fallbackDecision } from '../src/arena/runner';
import type { ArenaObservation } from '../src/arena/types';

const startedAt = Date.now();
const name = `MCP 混合接入验证 ${startedAt}`;
const root = resolve('data/arena');
const controller = new AbortController();
let mcp: ReturnType<typeof spawn> | undefined;
const task = runArena({
  name, timeoutSec: 4, maxDurationMs: 120000,
  players: [{ id: 'local', name: '本机玩家', mode: 'heuristic' }, { id: 'external', name: 'MCP玩家', mode: 'mcp' }],
}, { signal: controller.signal, log: (message) => process.stdout.write(`${message}\n`) });

try {
  let configPath = '';
  while (!configPath && Date.now() - startedAt < 30000) {
    for (const dir of readdirSync(root)) {
      const manifestPath = join(root, dir, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string };
      const path = join(root, dir, 'mcp/external/mcp.json');
      if (manifest.name === name && existsSync(path)) configPath = path;
    }
    if (!configPath) await new Promise((r) => setTimeout(r, 200));
  }
  if (!configPath) throw new Error('未生成 MCP 配置');
  const config = JSON.parse(readFileSync(configPath, 'utf8')).mcpServers.sanguosha as {
    command: string; args: string[]; env: Record<string, string>;
  };
  const joinInfo = JSON.parse(readFileSync(join(configPath, '../join.json'), 'utf8')) as { arguments: { roomId: string } };
  mcp = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let requestId = 0;
  let buffer = '';
  const pending = new Map<number, { resolve: (result: any) => void; reject: (err: Error) => void }>();
  mcp.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const reply = JSON.parse(line);
      const request = pending.get(reply.id);
      if (!request) continue;
      pending.delete(reply.id);
      if (reply.error) request.reject(new Error(reply.error.message));
      else request.resolve(reply.result);
    }
  });
  mcp.stderr!.on('data', () => {});
  mcp.once('exit', () => { pending.forEach((p) => p.reject(new Error('MCP 进程退出'))); pending.clear(); });
  const rpc = (method: string, params: unknown) => new Promise<any>((resolveReply, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve: resolveReply, reject });
    mcp!.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  await rpc('initialize', {});
  await rpc('tools/call', { name: 'joinRoom', arguments: joinInfo.arguments });
  let decision: ReturnType<typeof fallbackDecision> | undefined;
  let moves = 0;
  while (Date.now() - startedAt < 120000) {
    const result = await rpc('tools/call', { name: 'play', arguments: { ...decision, waitTimeoutMs: 500 } });
    const data = result.structuredContent as { gameOver: unknown; needsAction: boolean; observation: ArenaObservation | null };
    if (data.gameOver) break;
    decision = data.needsAction && data.observation?.actions.length ? {
      ...fallbackDecision(data.observation), memory: 'MCP 独立记忆验证', strategySummary: '外部 MCP 自主提交候选动作。',
    } : undefined;
    if (decision) moves++;
  }
  const result = await task;
  if (result.status !== 'completed' || moves === 0) throw new Error(`混合对局未完成：${result.status} moves=${moves}`);
  const records = readFileSync(join(root, result.id, 'players/external/decisions.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line) as { result: string });
  const rejected = records.filter((r) => r.result === 'rejected').length;
  if (rejected > 20) throw new Error(`MCP 持续提交非法动作：${rejected} 次拒绝`);
  process.stdout.write(`MCP 混合验证通过：${moves} 次决策，${rejected} 次拒绝，归档 ${result.id}\n`);
} finally {
  controller.abort();
  mcp?.kill();
  await task;
}
