// src/ai-mcp/server.ts
// MCP server stdio 入口：单进程单座次。
// 读 stdin 每行一条 JSON-RPC（NDJSON），响应写 stdout，日志写 stderr。
//
// 环境变量：
//   SGS_SERVER_URL（默认 ws://localhost:3930/ws，注意 /ws 路径）
//   SGS_ROOM_ID（不提供则首次 play 用 startGame 创建 debug 房）
//   SGS_SEAT（默认 0）
//   SGS_PLAYER_COUNT（创建房时用，默认 2）
import * as readline from 'node:readline';
import { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import { handleMcpRequest, type JsonRpcRequest, type JsonRpcResponse, type McpHandlerContext } from './mcpServer';

const SERVER_URL = process.env.SGS_SERVER_URL ?? 'ws://localhost:3930/ws';
const ROOM_ID = process.env.SGS_ROOM_ID ?? null;
const SEAT = Number(process.env.SGS_SEAT ?? '0');
const PLAYER_COUNT = Number(process.env.SGS_PLAYER_COUNT ?? '2');

function logErr(msg: string): void {
  process.stderr.write(`[sanguosha-mcp] ${msg}\n`);
}

async function main(): Promise<void> {
  const hgc = new HeadlessGameClient(SERVER_URL, {
    onError: (e) => logErr(`WS error: ${e.message}`),
    onPhaseChange: (p) => logErr(`phase -> ${p}`),
    onGameOver: (w) => logErr(`game over: ${w}`),
  });
  let started = false;
  const ensureStarted = async (): Promise<void> => {
    if (started) return;
    started = true;
    if (ROOM_ID) {
      await hgc.connect(ROOM_ID, SEAT);
    } else {
      hgc.createDebugRoom(PLAYER_COUNT);
    }
    hgc.sendReady();
    // 创建房者（无 ROOM_ID）为房主，发 start
    if (!ROOM_ID) hgc.sendStartGame();
  };

  const ctx: McpHandlerContext = { hgc, ensureStarted, seat: SEAT };

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      logErr(`non-JSON line ignored: ${trimmed.slice(0, 80)}`);
      return;
    }
    try {
      const res = await handleMcpRequest(req, ctx);
      if (res) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logErr(`handler error: ${msg}`);
    }
  });

  rl.on('close', () => {
    logErr('stdin closed, disconnecting');
    hgc.disconnect();
    process.exit(0);
  });

  logErr(`serving on stdio (server=${SERVER_URL}, room=${ROOM_ID ?? '<create>'}, seat=${SEAT})`);
}

main().catch((e) => {
  logErr(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
