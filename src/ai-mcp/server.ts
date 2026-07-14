// src/ai-mcp/server.ts
// MCP server stdio 入口：单进程单座次。
// 读 stdin 每行一条 JSON-RPC（NDJSON），响应写 stdout，日志写 stderr。
//
// 环境变量：
//   SGS_SERVER_URL（覆盖默认服务器地址，注意 /ws 路径）
//   SGS_ROOM_ID（不提供则首次 play 用 startGame 创建 debug 房）
//   SGS_SEAT（默认 0）
//   SGS_PLAYER_COUNT（创建房时用，默认 2）
//   SGS_PLAYER_ID（指定玩家身份；multiplayer 直接采用，debug 作为固定测试 id 默认 'debug-ai'）
import * as readline from 'node:readline';
import { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import {
  handleMcpRequest,
  normalizeStartGame,
  type JsonRpcRequest,
  type McpHandlerContext,
  type StartGameOpts,
} from './mcpServer';
import { joinAndReady, advanceToStart, applyConfigUpdate } from './lobby';
import type { RoomConfig } from '../server/protocol';
import { DEFAULT_CHAT_CONFIG } from '../server/protocol';

// 构建期注入的默认服务器 URL。
// tsx 直跑源码时该符号未定义 → typeof 守卫避免 ReferenceError，兜底 localhost（本仓库开发用）。
// vite build 时 vite.mcp.config.ts 的 define 把它替换为 SGS_PUBLIC_URL 注入值。
declare const __SGS_DEFAULT_URL__: string | undefined;
const DEFAULT_URL =
  typeof __SGS_DEFAULT_URL__ !== 'undefined' && __SGS_DEFAULT_URL__
    ? __SGS_DEFAULT_URL__
    : 'http://localhost:3930';
const SERVER_URL = process.env.SGS_SERVER_URL ?? DEFAULT_URL;
const ROOM_ID = process.env.SGS_ROOM_ID ?? null;
const SEAT = Number(process.env.SGS_SEAT ?? '0');
const PLAYER_COUNT = Number(process.env.SGS_PLAYER_COUNT ?? '2');
const PLAYER_ID = process.env.SGS_PLAYER_ID ?? null;

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
  // 环境变量作为默认值,被 opts 覆盖
  const ensureStarted = async (opts?: StartGameOpts): Promise<void> => {
    const o = opts ?? normalizeStartGame(true);
    if (o.mode === 'multiplayer') {
      // 旁观者模式：joinAsSpectator 后直接等待，不准备/不开局。
      if (o.asSpectator) {
        if (!started) {
          const targetRoom = o.roomId ?? ROOM_ID;
          if (!targetRoom) throw new Error('旁观模式需要 roomId');
          await hgc.joinAsSpectator(targetRoom, o.playerId ?? PLAYER_ID ?? undefined);
          started = true;
          logErr(`spectator joined: ${targetRoom}`);
        }
        return;
      }
      // 首次：建/加入 + ready，立即返回 lobby + roomId（不等全员就绪）。
      // 这样房主能把房间码分享给他人，他人在独立进程加入后，再由后续 play 调用
      // 触发 advanceToStart 推进开局。避免"阻塞等 ready 期间无法启动对方"的死锁。
      if (!started) {
        const roomConfig: RoomConfig | undefined =
          o.timeoutScale !== undefined
            ? { name: o.name ?? '房间', timeoutScale: o.timeoutScale, charPool: 'all', handSize: 4, chat: DEFAULT_CHAT_CONFIG }
            : undefined;
        const result = await joinAndReady(hgc, {
          mode: o.roomId ? 'join' : 'create',
          roomId: o.roomId ?? ROOM_ID ?? undefined,
          name: o.name,
          maxPlayers: o.maxPlayers ?? PLAYER_COUNT,
          playerId: o.playerId ?? PLAYER_ID ?? undefined,
          config: roomConfig,
        });
        started = true;
        logErr(
          `multiplayer room joined: ${result.roomId} seat=${hgc.seatIndex} host=${result.isHost}`,
        );
        return;
      }
      // 后续：若仍在 lobby，先应用配置变更（timeoutScale/name），再推进开局。
      // roomId/playerId/mode 等不可变字段保持首次值；只有 RoomConfig 字段会被更新。
      if (hgc.phase === 'lobby') {
        await applyConfigUpdate(hgc, { timeoutScale: o.timeoutScale, name: o.name });
        await advanceToStart(hgc, o.readyTimeoutMs);
      }
      return;
    }
    // debug 模式(旧路径)
    // 使用固定测试 id(可由 SGS_PLAYER_ID 环境变量覆盖),保证重连/重开复用同一身份。
    if (started) {
      // 仍在 lobby 时应用配置变更（如"再来一局"回到 lobby）
      if (hgc.phase === 'lobby') {
        await applyConfigUpdate(hgc, { timeoutScale: o.timeoutScale });
      }
      return;
    }
    const debugPlayerId = PLAYER_ID ?? 'debug-ai';
    const debugConfig: RoomConfig | undefined =
      o.timeoutScale !== undefined
        ? { name: '调试房间', timeoutScale: o.timeoutScale, charPool: 'all', handSize: 4, chat: DEFAULT_CHAT_CONFIG }
        : undefined;
    if (o.roomId ?? ROOM_ID) {
      await hgc.connect(o.roomId ?? ROOM_ID!, SEAT, debugPlayerId);
    } else {
      await hgc.createDebugRoom(o.playerCount ?? PLAYER_COUNT, debugConfig, debugPlayerId);
    }
    await hgc.sendReady();
    if (!(o.roomId ?? ROOM_ID)) await hgc.sendStartGame();
    started = true;
  };

  const ctx: McpHandlerContext = { hgc, ensureStarted, seat: SEAT, playState: { lastView: null } };

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
  logErr(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
