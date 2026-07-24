// src/engine/view/cardFilterCandidates.ts
// useCard / useCardAndTarget prompt 的合法手牌 candidates 解析。
//
// 背景:CardFilter.filter 是函数,无法跨进程序列化(SSE/JSON)。
// 前端(resolvePendingRespond)与无头客户端拿不到 filter 时,只能按 requestType
// 前缀猜测 cardName——对技能代价弃牌(界放权/放权/据守 等,requestType 前缀是技能名
// 而非卡名)会误推为 c.name===技能名,匹配 0 张 → 玩家无法弃牌、被迫超时。
// 本 helper 在引擎进程内(投影层)跑 filter,生成可序列化的 candidates: string[],
// 随 pending 下发;前端优先用 candidates 重建成员判断 filter(与 choosePlayerCandidates 同构)。
//
// 调用点(与 resolveChoosePlayerCandidates 并列):
//   - 请求回应.toViewEvents(增量 event 主路径)
//   - buildView(全量快照/重连路径)
//   - 并行回应.toViewEvents
import type { ActionPrompt, GameState } from '../types';
import type { UseCardAndTargetPrompt, UseCardPrompt } from '../types';

/**
 * 对 useCard / useCardAndTarget prompt 注入可序列化的 cardFilter.candidates。
 * @param prompt  原始 prompt(可能含 filter 函数)
 * @param state   引擎状态(读取 target 手牌 + cardMap)
 * @param target  被询问座次(filter 针对其手牌计算);target<0(广播型)时跳过
 * @returns 带 candidates 的 prompt;无 filter / 无手牌 / 广播型时原样返回
 */
export function resolveCardFilterCandidates(
  prompt: ActionPrompt,
  state: GameState,
  target: number,
): ActionPrompt {
  if (prompt.type !== 'useCard' && prompt.type !== 'useCardAndTarget') return prompt;
  const p = prompt as UseCardPrompt | UseCardAndTargetPrompt;
  const cf = p.cardFilter;
  // 1. 技能已显式提供 candidates(含空数组,表示确无可选)→ 权威,尊重
  if (cf.candidates !== undefined) return prompt;
  // 广播型(target<0,如无懈可击):无单一目标手牌,且此类走 registry 路径,跳过
  if (target < 0) return prompt;
  // 3. 无 filter → 无法计算,原样返回(前端 fallback 到 registry/derive)
  if (!cf.filter) return prompt;

  const player = state.players[target];
  if (!player) return prompt;
  const candidates: string[] = [];
  for (const cardId of player.hand) {
    const card = state.cardMap[cardId];
    if (card && cf.filter(card)) candidates.push(cardId);
  }
  return { ...p, cardFilter: { ...cf, candidates } };
}
