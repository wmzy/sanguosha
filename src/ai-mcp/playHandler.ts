// src/ai-mcp/playHandler.ts
// play 工具核心阻塞逻辑：执行 action → 阻塞等待直到 needsAction=true / 游戏结束 / 超时。
import type { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { ClientMessage as EngineClientMessage, ViewEvent } from '../engine/types';
import { projectView } from './viewProjector';
import { pickBestAction } from './heuristics';
import type { AiViewSnapshot, AvailableAction } from '../client/headless/types';

export interface PlayInput {
  /** 要执行的操作；省略=纯等待。 */
  action?: { message: EngineClientMessage };
  waitTimeoutMs?: number;
}

export interface PlayResult {
  /** 当前房间码（lobby 阶段供房主分享给人类加入；playing 阶段恒定） */
  roomId: string | null;
  phase: 'lobby' | 'playing' | 'ended';
  gameOver: { winner: string } | null;
  needsAction: boolean;
  view: AiViewSnapshot | null;
  availableActions: AvailableAction[];
  /** 启发式评分器推荐的最优动作（availableActions 非空时计算；LLM 兜底用）。 */
  recommendedAction: AvailableAction | null;
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
  // 自动注册技能：选将后 view 有 character + skills 但 registry 可能未注册。
  // 每次调 play 时检查并补注册（幂等：registerSkillActions 重复调用无害）。
  const v = hgc.view;
  if (v) {
    for (const p of v.players) {
      if (p.character && p.skills.length > 0) {
        await hgc.loadSkillActions(p.skills, p.index);
      }
    }
  }
  const timeoutMs = input.waitTimeoutMs ?? DEFAULT_WAIT_MS;
  const deadline = Date.now() + timeoutMs;
  return new Promise<PlayResult>((resolve) => {
    const snapshot = (): PlayResult => {
      const view = hgc.view ? projectView(hgc.view) : null;
      const availableActions = hgc.getAvailableActions();
      const phase: PlayResult['phase'] = hgc.isSpectator
        ? (hgc.phase === 'ended' ? 'ended' : 'playing')
        : (hgc.phase === 'connecting' ? 'lobby' : hgc.phase);
      return {
        roomId: hgc.roomId,
        phase,
        gameOver: hgc.gameOverWinner ? { winner: hgc.gameOverWinner } : null,
        needsAction: hgc.isSpectator ? false : hgc.needsAction(),
        view,
        availableActions: hgc.isSpectator ? [] : availableActions,
        recommendedAction: !hgc.isSpectator && view ? pickBestAction(view, availableActions) : null,
        recentEvents: hgc.drainNewEvents(),
        lastActionResult,
      };
    };
    const settle = () => resolve(snapshot());
    const tick = () => {
      // 服务端拒了本次 action：报告 rejected，继续等下一个 needsAction 点
      if (hgc.consumeActionRejected()) {
        lastActionResult = 'rejected';
      }
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
