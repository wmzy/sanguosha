// src/ai-mcp/playHandler.ts
// play 工具核心阻塞逻辑：执行 action → 阻塞等待直到 needsAction=true / 游戏结束 / 超时。
//
// 返回增量状态（stateDiff + newLog）而非完整视图，降低累积 token 开销。
// LLM 可通过 getSnapshot 工具按需获取完整快照。
import type { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { ClientMessage as EngineClientMessage, ViewEvent, Card } from '../engine/types';
import { projectView, projectDiff, type ViewStateDiff } from './viewProjector';
import { pickBestAction } from './heuristics';
import type { AiViewSnapshot, AvailableAction } from '../client/headless/types';

/** play 工具跨调用持久状态（由调用方持有，传入每次 runPlay）。 */
export interface PlayState {
  /** 上次 play 返回时的完整投影视图，用于本次 diff 的基线。 */
  lastView: AiViewSnapshot | null;
}

export interface PlayInput {
  /** 要执行的操作；省略=纯等待。 */
  action?: { message: EngineClientMessage };
  waitTimeoutMs?: number;
  /** play 状态引用；提供时计算 stateDiff 并更新 lastView。 */
  state?: PlayState;
}

export interface PlayResult {
  /** 当前房间码（lobby 阶段供房主分享给人类加入；playing 阶段恒定） */
  roomId: string | null;
  phase: 'lobby' | 'playing' | 'ended';
  gameOver: { winner: string } | null;
  needsAction: boolean;

  // ── 决策必需（每次全量） ──
  turn: { round: number } | null;
  currentPlayerIndex: number | null;
  pending: AiViewSnapshot['pending'];
  availableActions: AvailableAction[];
  /** 启发式评分器推荐的最优动作（availableActions 非空时计算；LLM 兜底用）。 */
  recommendedAction: AvailableAction | null;

  // ── 自己手牌（每次全量，最高频使用） ──
  myHand: Card[] | null;

  // ── 增量 ──
  /** 相对上次 play 的状态变化（null=游戏尚未开始的 lobby 阶段）。 */
  stateDiff: ViewStateDiff | null;
  /** 上次以来新增的事件日志。 */
  newLog: ViewEvent[];

  /** accepted=被服务端接受 / rejected=被拒 / timeout=决策慢被服务端超时 resolve / not-applicable=本次未执行 action */
  lastActionResult: 'accepted' | 'rejected' | 'timeout' | 'not-applicable';
}

// 25s: 低于 MCP 客户端默认 30s 超时，避免 play 调用在等待 needsAction 时被客户端截断。
const DEFAULT_WAIT_MS = 25000;
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
      const fullView = hgc.view ? projectView(hgc.view) : null;
      const availableActions = hgc.isSpectator ? [] : hgc.getAvailableActions();
      const phase: PlayResult['phase'] = hgc.isSpectator
        ? (hgc.phase === 'ended' ? 'ended' : 'playing')
        : (hgc.phase === 'connecting' ? 'lobby' : hgc.phase);

      // 计算 diff
      let stateDiff: ViewStateDiff | null = null;
      let myHand: Card[] | null = null;
      if (fullView) {
        myHand = fullView.players[fullView.viewer]?.hand ?? null;
        const prev = input.state?.lastView ?? null;
        stateDiff = projectDiff(prev, fullView);
        // 更新调用方的 state
        if (input.state) input.state.lastView = fullView;
      }

      return {
        roomId: hgc.roomId,
        phase,
        gameOver: hgc.gameOverWinner ? { winner: hgc.gameOverWinner } : null,
        needsAction: hgc.isSpectator ? false : hgc.needsAction(),
        turn: fullView ? fullView.turn : null,
        currentPlayerIndex: fullView ? fullView.currentPlayerIndex : null,
        pending: fullView ? fullView.pending : null,
        availableActions,
        recommendedAction: !hgc.isSpectator && fullView ? pickBestAction(fullView, availableActions) : null,
        myHand,
        stateDiff,
        newLog: hgc.drainNewEvents(),
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
      // lobby/connecting 阶段立即返回，让调用方重新调 play 重试 advanceToStart。
      // 否则 runPlay 会阻塞到 deadline（120s），超出 MCP 客户端 30s 超时。
      if (hgc.phase === 'connecting' || hgc.phase === 'lobby') return settle();
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
