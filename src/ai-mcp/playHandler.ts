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
  /** 等待上限(ms)，默认 Infinity（无限阻塞直到 needsAction/gameOver）。
   *  服务端自有 pending 超时推进状态；仅在需要主动上限保护时传有限值。 */
  waitTimeoutMs?: number;
  /** play 状态引用；提供时计算 stateDiff 并更新 lastView。 */
  state?: PlayState;
  /** lobby/connecting 阶段的非阻塞推进回调（房主全员就绪时发 startGame）。
   *  由调用方提供（createLobbyAdvancer），runPlay 在 lobby 阶段周期调用以推进开局，
   *  避免立即返回导致 agent 高频轮询浪费 token。 */
  lobbyAdvance?: () => void;
}

export interface PlayResult {
  /** 当前房间码（lobby 阶段供房主分享给人类加入；playing 阶段恒定） */
  roomId: string | null;
  phase: 'lobby' | 'playing' | 'ended';
  gameOver: { winner: string } | null;
  needsAction: boolean;
  /** 当前是否房主（让 LLM 能自检：本该加入却变房主时主动重试） */
  isHost: boolean;
  /** 实际生效的身份（host=建房房主 / guest=加入 / spectator=旁观 / null=未启动） */
  joinedAs: 'host' | 'guest' | 'spectator' | null;

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

// 默认无限等待：服务端自有 pending 超时（30~50s × timeoutScale）推进状态，
// runPlay 的 tick 每 TICK_MS 检查即可在 ended/needsAction 时返回。固定 deadline
// 只在异常兜底时有意义——默认不设，由调用方按需传 waitTimeoutMs 设上限。
const TICK_MS = 20;

export async function runPlay(hgc: HeadlessGameClient, input: PlayInput): Promise<PlayResult> {
  let lastActionResult: PlayResult['lastActionResult'] = 'not-applicable';
  // 提交 action 后,必须等服务端真正处理(seq 推进 / 被拒 / 游戏结束)再判定 needsAction。
  // sendAction 是 fire-and-forget 的 HTTP POST,首个同步 tick 看到的仍是 pre-action 旧视图
  // (此时 needsAction 仍为提交前的 true)→ 立即返回 accepted + 旧手牌,LLM 误判"未生效"并
  // 重复提交同一张牌。用 seq 基线守门,确保返回的视图至少反映了本次 action 的处理结果。
  const submittedAction = !!input.action?.message;
  const seqBeforeAction = submittedAction ? hgc.lastSeq : -1;
  let actionProcessed = !submittedAction;
  if (submittedAction) {
    hgc.sendAction(input.action!.message);
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
  const timeoutMs = input.waitTimeoutMs ?? Infinity;
  const deadline = Date.now() + timeoutMs;
  return new Promise<PlayResult>((resolve) => {
    const snapshot = (): PlayResult => {
      const fullView = hgc.view ? projectView(hgc.view) : null;
      const availableActions = hgc.isSpectator ? [] : hgc.getAvailableActions();
      const phase: PlayResult['phase'] = hgc.isSpectator
        ? (hgc.phase === 'ended' ? 'ended' : 'playing')
        : (hgc.phase === 'connecting' ? 'lobby' : hgc.phase);

      // 派生身份：旁观者→spectator；否则按 roomState.hostId 判 host/guest；
      // playerId 未就绪（未启动或连接中）→null。供 LLM 自检“选错工具”。
      const rs = hgc.roomState;
      const joinedAs: PlayResult['joinedAs'] = hgc.isSpectator
        ? 'spectator'
        : hgc.playerId
          ? (rs?.hostId && rs.hostId === hgc.playerId ? 'host' : 'guest')
          : null;
      const isHost = joinedAs === 'host';

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
        isHost,
        joinedAs,
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
        actionProcessed = true; // 被拒 = 服务端已处理本次 action
      }
      if (hgc.phase === 'ended' || hgc.gameOverWinner !== null) return settle();
      // 提交了 action 但尚未确认处理:等待 seq 推进(状态变化)后再判定 needsAction,
      // 避免用 pre-action 旧视图的 needsAction=true 立即返回(见函数头注释)。
      if (!actionProcessed) {
        if (hgc.lastSeq > seqBeforeAction) {
          actionProcessed = true;
        } else {
          if (Date.now() >= deadline) {
            if (lastActionResult === 'accepted') lastActionResult = 'timeout';
            return settle();
          }
          setTimeout(tick, TICK_MS);
          return;
        }
      }
      // lobby/connecting 阶段：周期推进（房主开局）并阻塞等待进入 playing，
      // 而非立即返回——避免 agent 在游戏未开始时空轮询浪费 token。
      if (hgc.phase === 'connecting' || hgc.phase === 'lobby') {
        input.lobbyAdvance?.();
      } else if (hgc.needsAction()) {
        return settle();
      }
      // 兜底 deadline：默认 Infinity（Date.now() < Infinity 恒成立，永不触发），
      // 仅当调用方显式传 waitTimeoutMs 时生效，作为极端卡死的上限保护。
      if (Date.now() >= deadline) {
        if (lastActionResult === 'accepted') lastActionResult = 'timeout';
        return settle();
      }
      setTimeout(tick, TICK_MS);
    };
    tick();
  });
}
