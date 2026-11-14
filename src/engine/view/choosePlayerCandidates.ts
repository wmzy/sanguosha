// src/engine/view/choosePlayerCandidates.ts
// choosePlayer prompt 的候选目标列表(candidates)解析。
//
// 背景:ChoosePlayerPrompt.filter 是函数,无法跨进程序列化(SSE/JSON)。
// 前端(AwaitingPrompt)与无头客户端(appendRespondActions)拿不到 filter,
// 导致无法获知哪些目标合法。本 helper 在引擎进程内(投影层)跑 filter,
// 生成可序列化的 candidates: number[],随 pending 下发。
//
// 调用点:
//   - 请求回应.toViewEvents(增量 event 主路径)
//   - buildView(全量快照/重连路径)
//
// 策略:
//   1. prompt 已显式提供 candidates(技能在 applyAtom 时算好)→ 直接用,权威。
//   2. 无 candidates 但有 filter → 构造轻量 view(与 buildView 共用 projectPlayer
//      权威玩家投影)跑 filter 计算。filter 主要访问 view.players[t] 与 view.cardMap,
//      故两者均提供;filter 访问了 view 上不存在的字段而抛错时保守纳入(后端 respond
//      validate 拒非法目标)。
//   3. 无 filter → 返回原样(前端 fallback 到所有存活)。
import type { ActionPrompt, GameState, GameView } from '../types';
import { projectPlayer } from './projectPlayer';

export function resolveChoosePlayerCandidates(
  prompt: ActionPrompt,
  state: GameState,
): ActionPrompt {
  if (prompt.type !== 'choosePlayer') return prompt;
  const cp = prompt;

  // 1. 技能已显式提供 candidates(含空数组,表示确无候选)→ 权威,尊重。
  if (cp.candidates !== undefined) return prompt;
  // 3. 无 filter → 无法计算,原样返回(前端 fallback 所有存活)。
  if (!cp.filter) return prompt;

  // 2. 构造轻量 view 跑 filter。
  // 与 buildView 共用 projectPlayer 权威投影(同一字段集):filter 访问
  // tags/distanceVars/turnUsage 等新字段不再抛错走保守纳入。
  // viewer=-1:candidates 随 pending 广播给所有 viewer,不按单一视角红化
  // (无手牌投影;身份仅主公/阵亡等公开信息可见)。
  // filter 访问了 view 上确实不存在的字段而抛错时仍保守纳入(后端 respond validate 拒非法目标)。
  const players = state.players.map((_p, i) => projectPlayer(state, i, { viewer: -1 }));
  const partialView = { players, cardMap: state.cardMap } as GameView;

  const candidates: number[] = [];
  for (let i = 0; i < players.length; i++) {
    if (!players[i].alive) continue;
    let ok: boolean;
    try {
      ok = !!cp.filter(partialView, i);
    } catch {
      // filter 访问了未提供的 view 字段 → 保守纳入,后端 validate 兜底。
      ok = true;
    }
    if (ok) candidates.push(i);
  }
  return { ...cp, candidates };
}
