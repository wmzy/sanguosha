// src/ai-mcp/lobby.ts
// 大厅编排：建/加入普通多人房 → 准备 → 等待全员就绪 → (房主)开局。
// 基于 HGC 同步 getter 轮询（沿用 playHandler 的 tick 模型），无 WS 直接依赖。
import type { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { RoomConfig } from '../server/protocol';

export interface LobbyOpts {
  /** 'create'=建房(房主)；'join'=加入指定房间 */
  mode: 'create' | 'join';
  /** join 模式必填 */
  roomId?: string;
  /** create 模式：房间名 */
  name?: string;
  /** create 模式：最大人数，默认 2 */
  maxPlayers?: number;
  /** create 模式：房间配置 */
  config?: RoomConfig;
  /** 玩家 id：给定则采用，否则服务端自动生成 */
  playerId?: string;
}

const TICK_MS = 50;

/** 判定全员就绪：readyPlayers 集合 === playerIds 集合，且至少 minPlayers 人。
 *  minPlayers 仅用于「等齐开局」：AI 编排/多进程演示必须等全部座位到齐，
 *  否则房主的 play 循环会在第 2 人就绪时立刻开局，后续 guest 全部撞「游戏已开始」。 */
function isAllReady(hgc: HeadlessGameClient, minPlayers = 2): boolean {
  const rs = hgc.roomState;
  if (!rs) return false;
  if (rs.playerIds.length < Math.max(2, minPlayers)) return false;
  if (rs.readyPlayers.length !== rs.playerIds.length) return false;
  return true;
}

/**
 * 建/加入房间并发送 ready（不等全员就绪）。
 * 用于 multiplayer 分阶段编排：首次只到 ready，立即返回 lobby + roomId，
 * 供房主把房间码分享给他人；他人加入后再用 createLobbyAdvancer 推进开局。
 */
export async function joinAndReady(
  hgc: HeadlessGameClient,
  opts: LobbyOpts,
): Promise<{ roomId: string; playerId: string; isHost: boolean }> {
  if (opts.mode === 'create') {
    await hgc.createRoom(
      opts.name ?? `房间${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      opts.maxPlayers ?? 2,
      opts.config,
      opts.playerId,
    );
  } else {
    if (!opts.roomId) throw new Error('join 模式需要 roomId');
    await hgc.joinRoom(opts.roomId, opts.playerId);
  }
  const joinDeadline = Date.now() + 10_000;
  await waitFor(() => hgc.playerId !== null, joinDeadline, '加入房间超时');
  void hgc.sendReady();
  const rs = hgc.roomState;
  return {
    roomId: hgc.roomId ?? '',
    playerId: hgc.playerId ?? '',
    isHost: rs?.hostId === hgc.playerId,
  };
}

/** 判定是否已进入对局阶段（封装避免 CFA 窄化 getter）。 */
function isPlaying(hgc: HeadlessGameClient): boolean {
  return hgc.phase === 'playing';
}

export interface LobbyAdvancerOpts {
  /** 开局所需的最少玩家数。默认 2；AI 编排应传房间满员数，等齐再开局。 */
  minPlayers?: number;
}

/**
 * 创建 lobby 推进器：返回幂等、非阻塞的推进函数，供 playHandler 的 tick 循环
 * 在 lobby/connecting 阶段周期调用。
 *
 * 全员就绪后房主发送一次 startGame（内部去重，避免 phase 切换前重复发送）；
 * 非房主 / 未全员就绪 / 已进入 playing 时为 no-op。这样 runPlay 在 lobby 阶段可持续
 * 阻塞等待进入 playing + needsAction，而非立即返回迫使 agent 高频轮询浪费 token。
 */
export function createLobbyAdvancer(
  hgc: HeadlessGameClient,
  opts: LobbyAdvancerOpts = {},
): () => void {
  const minPlayers = Math.max(2, opts.minPlayers ?? 2);
  let startRequested = false;
  return () => {
    if (startRequested) return;
    if (isPlaying(hgc)) return;
    if (!isAllReady(hgc, minPlayers)) return;
    // 全员就绪：房主发一次开局；非房主无需动作。置 startRequested 避免重复发送。
    startRequested = true;
    const rs = hgc.roomState;
    if (rs?.hostId && rs.hostId === hgc.playerId) {
      void hgc.sendStartGame();
    }
  };
}

/** 轮询条件直至满足或超时。throwOnTimeout=false 时超时静默返回。 */
function waitFor(
  cond: () => boolean,
  deadline: number,
  errorMsg: string,
  throwOnTimeout = true,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() >= deadline) {
        return throwOnTimeout ? reject(new Error(errorMsg)) : resolve();
      }
      setTimeout(tick, TICK_MS);
    };
    tick();
  });
}
