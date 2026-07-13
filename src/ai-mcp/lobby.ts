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
  /** 等待全员就绪的超时(ms)，默认 300000 (5min) */
  readyTimeoutMs?: number;
}

export interface LobbyResult {
  roomId: string;
  playerId: string;
  /** 是否房主 */
  isHost: boolean;
  /** 实际座次数 */
  playerCount: number;
  /** 'playing'=已开局；'lobby'=超时仍未开局 */
  phase: 'playing' | 'lobby';
}

const DEFAULT_READY_TIMEOUT_MS = 300_000;
const TICK_MS = 50;

/**
 * 若 fields 中的 RoomConfig 字段与当前房间配置不同，发送 updateConfig 更新。
 * 仅在 lobby 阶段有效（服务端 updateConfig 要求 status='等待中'）。
 * 以 hgc.roomState?.config 为基线增量覆盖，未变化的字段保留原值。
 * 返回 true 表示有变更并已发送。
 */
export async function applyConfigUpdate(
  hgc: HeadlessGameClient,
  fields: { timeoutScale?: number; name?: string },
): Promise<boolean> {
  const current = hgc.roomState?.config;
  if (!current) return false;
  const next: RoomConfig = { ...current };
  let changed = false;
  if (fields.timeoutScale !== undefined && fields.timeoutScale !== current.timeoutScale) {
    next.timeoutScale = fields.timeoutScale;
    changed = true;
  }
  if (fields.name !== undefined && fields.name !== current.name) {
    next.name = fields.name;
    changed = true;
  }
  if (changed) {
    await hgc.sendUpdateConfig(next);
  }
  return changed;
}

/** 判定全员就绪：readyPlayers 集合 === playerIds 集合，且至少 2 人。 */
function isAllReady(hgc: HeadlessGameClient): boolean {
  const rs = hgc.roomState;
  if (!rs) return false;
  if (rs.playerIds.length < 2) return false;
  if (rs.readyPlayers.length !== rs.playerIds.length) return false;
  return true;
}

/**
 * 建/加入房间并发送 ready（不等全员就绪）。
 * 用于 multiplayer 分阶段编排：首次只到 ready，立即返回 lobby + roomId，
 * 供房主把房间码分享给他人；他人加入后再用 advanceToStart 推进开局。
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
  hgc.sendReady();
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

/**
 * 等待全员就绪并推进开局（房主 sendStartGame；非房主仅等待）。
 * 超时静默返回 false。返回 true 表示已进入 playing。
 * 幂等：可重复调用，已在 playing 时直接返回 true。
 */
export async function advanceToStart(
  hgc: HeadlessGameClient,
  readyTimeoutMs?: number,
): Promise<boolean> {
  if (isPlaying(hgc)) return true;
  const readyDeadline = Date.now() + (readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
  await waitFor(() => isAllReady(hgc), readyDeadline, '等待全员就绪超时', false);
  if (!isAllReady(hgc)) return false;
  const rs = hgc.roomState;
  if (rs?.hostId === hgc.playerId) {
    hgc.sendStartGame();
  }
  const startDeadline = Date.now() + 15_000;
  await waitFor(() => isPlaying(hgc), startDeadline, '开局超时', false);
  return isPlaying(hgc);
}

/**
 * 加入房间并推进到开局。
 * create 模式：建房→准备→等待他人加入并就绪→房主开局。
 * join 模式：加入→准备→等待房主开局。
 * 返回时 phase 应为 'playing'（已开局）；超时则 phase='lobby'。
 */
export async function joinAndStartRoom(
  hgc: HeadlessGameClient,
  opts: LobbyOpts,
): Promise<LobbyResult> {
  // 1. 建/加入房间
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

  // 2. 等 room_joined（playerId 就绪）
  const joinDeadline = Date.now() + 10_000;
  await waitFor(() => hgc.playerId !== null, joinDeadline, '加入房间超时');

  // 3. 准备
  hgc.sendReady();

  // 4. 等待全员就绪(超时静默返回 lobby,由调用方决定后续)
  const readyDeadline = Date.now() + (opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
  await waitFor(() => isAllReady(hgc), readyDeadline, '等待全员就绪超时', false);
  if (!isAllReady(hgc)) {
    return {
      roomId: hgc.roomId ?? '',
      playerId: hgc.playerId ?? '',
      isHost: hgc.roomState?.hostId === hgc.playerId,
      playerCount: hgc.roomState?.playerIds.length ?? 0,
      phase: 'lobby',
    };
  }

  // 5. 房主开局；非房主等开局
  const rs = hgc.roomState;
  const isHost = rs?.hostId === hgc.playerId;
  if (isHost) {
    hgc.sendStartGame();
  }

  // 6. 等开局（phase→playing）
  const startDeadline = Date.now() + 15_000;
  await waitFor(
    () => hgc.phase === 'playing',
    startDeadline,
    '开局超时',
    // 超时不抛错：返回 lobby 状态，让调用方决定
    false,
  );

  const finalRs = hgc.roomState;
  const roomId = hgc.roomId ?? '';
  const playerId = hgc.playerId ?? '';
  return {
    roomId,
    playerId,
    isHost,
    playerCount: finalRs?.playerIds.length ?? 0,
    phase: hgc.phase === 'playing' ? 'playing' : 'lobby',
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
