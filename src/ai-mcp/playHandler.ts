// src/ai-mcp/playHandler.ts
// play 工具核心阻塞逻辑：执行 action → 阻塞等待直到 needsAction=true / 游戏结束 / 超时。
import type { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { ClientMessage as EngineClientMessage, ViewEvent } from '../engine/types';
import { projectView } from './viewProjector';
import type { AiViewSnapshot, AvailableAction } from '../client/headless/types';

export interface PlayInput {
  /** 要执行的操作；省略=纯等待。 */
  action?: { message: EngineClientMessage };
  waitTimeoutMs?: number;
}

export interface PlayResult {
  phase: 'lobby' | 'playing' | 'ended';
  gameOver: { winner: string } | null;
  needsAction: boolean;
  view: AiViewSnapshot | null;
  availableActions: AvailableAction[];
  recentEvents: ViewEvent[];
  /** accepted=被服务端接受 / rejected=被拒 / timeout=决策慢被服务端超时 resolve / not-applicable=本次未执行 action */
  lastActionResult: 'accepted' | 'rejected' | 'timeout' | 'not-applicable';
}

const DEFAULT_WAIT_MS = 120000;
const TICK_MS = 20;

export async function runPlay(hgc: HeadlessGameClient, input: PlayInput): Promise<PlayResult> {
  let lastActionResult: PlayResult['lastActionResult'] = 'not-applicable';
  if (input.action?.message) {
    hgc.sendAction(input.action.message);
    lastActionResult = 'accepted';
  }
  const timeoutMs = input.waitTimeoutMs ?? DEFAULT_WAIT_MS;
  const deadline = Date.now() + timeoutMs;
  return new Promise<PlayResult>((resolve) => {
    const snapshot = (): PlayResult => ({
      phase: hgc.phase === 'connecting' ? 'lobby' : hgc.phase,
      gameOver: hgc.gameOverWinner ? { winner: hgc.gameOverWinner } : null,
      needsAction: hgc.needsAction(),
      view: hgc.view ? projectView(hgc.view) : null,
      availableActions: hgc.getAvailableActions(),
      recentEvents: hgc.drainNewEvents(),
      lastActionResult,
    });
    const settle = () => resolve(snapshot());
    const tick = () => {
      if (hgc.phase === 'ended' || hgc.gameOverWinner !== null) return settle();
      if (hgc.needsAction()) return settle();
      if (Date.now() >= deadline) {
        if (lastActionResult === 'accepted') lastActionResult = 'timeout';
        return settle();
      }
      setTimeout(tick, TICK_MS);
    };
    tick();
  });
}
