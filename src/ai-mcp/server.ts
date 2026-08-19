// src/ai-mcp/server.ts
// MCP server stdio 入口：单进程单座次。
// 读 stdin 每行一条 JSON-RPC（NDJSON），响应写 stdout，日志写 stderr。
//
// 环境变量：
//   SGS_SERVER_URL（覆盖默认服务器地址，注意 /ws 路径）
//   SGS_SEAT（默认 0；fallback ownerId 用，实际 multiplayer 座次由服务端按加入顺序分配）
//   SGS_PLAYER_COUNT（createRoom 默认 maxPlayers，默认 2）
//   SGS_PLAYER_ID（createRoom/joinRoom 默认 playerId）
//
// 工具与启动语义：
//   createRoom / joinRoom / spectateRoom 三选一启动（同一 MCP 连接只能启动一次）。
//   play 仅在已启动后可用；lobby→playing 推进融入 runPlay 的 tick 循环（lobbyAdvancer），lobby 阶段阻塞等待而非立即返回。
//   启动工具的 roomId 在 schema 层 required（joinRoom/spectateRoom），杜绝漏传静默建房的旧问题。
import * as readline from 'node:readline';
import { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import {
  handleMcpRequest,
  type JsonRpcRequest,
  type McpHandlerContext,
  type CreateRoomOpts,
  type JoinRoomOpts,
  type SpectateRoomOpts,
} from './mcpServer';
import { joinAndReady, createLobbyAdvancer } from './lobby';
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
const SEAT = Number(process.env.SGS_SEAT ?? '0');
const PLAYER_COUNT = Number(process.env.SGS_PLAYER_COUNT ?? '2');
const PLAYER_ID = process.env.SGS_PLAYER_ID ?? null;

// 自动账号:MCP 座次需要登录才能进普通房(游客模式已移除)。
// 默认按进程生成随机账号(注册一次,后续重启复用需显式配置);可用环境变量覆盖。
//   SGS_MCP_USERNAME / SGS_MCP_PASSWORD: 固定账号(推荐编排脚本显式分配)
//   SGS_MCP_TOKEN: 已有会话 token(跳过注册/登录)
const MCP_AUTH = {
  username: process.env.SGS_MCP_USERNAME,
  password: process.env.SGS_MCP_PASSWORD,
  token: process.env.SGS_MCP_TOKEN,
};
const autoAccount = (): { username: string; password: string } => ({
  // username 上限 24 位:pid 最多 7 位数字,预留后缀空间
  username: `ai-${String(process.pid).slice(-6)}-${Math.random().toString(36).slice(2, 8)}`,
  password: cryptoRandomHex(12),
});
function cryptoRandomHex(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function logErr(msg: string): void {
  process.stderr.write(`[sanguosha-mcp] ${msg}\n`);
}

type StartedRole = 'host' | 'guest' | 'spectator';

function buildRoomConfig(opts: { timeoutSec?: number; name?: string }, defaultName: string): RoomConfig | undefined {
  if (opts.timeoutSec === undefined && opts.name === undefined) return undefined;
  return {
    name: opts.name ?? defaultName,
    timeoutSec: opts.timeoutSec ?? 30,
    charPool: 'all',
    handSize: 4,
    chat: DEFAULT_CHAT_CONFIG,
    gameMode: '身份局',
  };
}

async function main(): Promise<void> {
  // auth:显式配置优先;否则每进程生成随机自动账号(注册一次,token 随进程存活)
  const auth = MCP_AUTH.token
    ? { token: MCP_AUTH.token }
    : MCP_AUTH.username && MCP_AUTH.password
      ? { username: MCP_AUTH.username, password: MCP_AUTH.password }
      : autoAccount();
  const hgc = new HeadlessGameClient(SERVER_URL, {
    onError: (e) => logErr(`WS error: ${e.message}`),
    onPhaseChange: (p) => logErr(`phase -> ${p}`),
    onGameOver: (w) => logErr(`game over: ${w}`),
  }, auth);
  logErr(`auth account: ${'username' in auth ? auth.username : '(token)'}`);

  let startedRole: StartedRole | null = null;

  const assertNotStarted = (attempting: StartedRole): void => {
    if (startedRole === null) return;
    if (startedRole === attempting) {
      // 幂等重试：同身份重复调用视为 no-op
      throw new Error(`已以 ${startedRole} 身份启动，重复调用将被忽略`);
    }
    throw new Error(
      `已以 ${startedRole} 身份启动，不能切换为 ${attempting}。如需切换请重启 MCP 连接。`,
    );
  };

  // ── 启动工具：建房做房主 ──
  const doCreateRoom = async (opts: CreateRoomOpts): Promise<void> => {
    assertNotStarted('host');
    const config = buildRoomConfig(opts, '房间');
    const result = await joinAndReady(hgc, {
      mode: 'create',
      name: opts.name,
      maxPlayers: opts.maxPlayers ?? PLAYER_COUNT,
      playerId: opts.playerId ?? PLAYER_ID ?? undefined,
      config,
    });
    startedRole = 'host';
    logErr(`multiplayer room created: ${result.roomId} seat=${hgc.seatIndex} host=${result.isHost}`);
    // 房主建房后允许 timeoutSec 后续在 play 内通过 applyConfigUpdate 应用（已 ready 后服务端仍接受 updateConfig 在 lobby）。
  };

  // ── 启动工具：加入指定房间 ──
  const doJoinRoom = async (opts: JoinRoomOpts): Promise<void> => {
    assertNotStarted('guest');
    const config = buildRoomConfig(opts, '房间');
    const result = await joinAndReady(hgc, {
      mode: 'join',
      roomId: opts.roomId,
      playerId: opts.playerId ?? PLAYER_ID ?? undefined,
      config,
    });
    startedRole = 'guest';
    logErr(`multiplayer room joined: ${result.roomId} seat=${hgc.seatIndex} host=${result.isHost}`);
  };

  // ── 启动工具：旁观者 ──
  const doSpectateRoom = async (opts: SpectateRoomOpts): Promise<void> => {
    assertNotStarted('spectator');
    await hgc.joinAsSpectator(opts.roomId, opts.playerId ?? PLAYER_ID ?? undefined);
    startedRole = 'spectator';
    logErr(`spectator joined: ${opts.roomId}`);
  };

  // lobby 推进器：runPlay 在 lobby 阶段周期调用，全员就绪且房主时发一次 startGame。
  // 非阻塞、幂等，替代原先 play 前单独阻塞 advanceToStart(5s) 的做法——推进融入
  // runPlay 的 tick 循环，lobby 阶段持续阻塞等待 playing，避免 agent 高频轮询浪费 token。
  const lobbyAdvance = createLobbyAdvancer(hgc);

  const isStarted = (): boolean => startedRole !== null;

  const ctx: McpHandlerContext = {
    hgc,
    doCreateRoom,
    doJoinRoom,
    doSpectateRoom,
    lobbyAdvance,
    isStarted,
    seat: SEAT,
    playState: { lastView: null },
  };

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

  logErr(`serving on stdio (server=${SERVER_URL}, seat=${SEAT})`);
}

main().catch((e) => {
  logErr(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
