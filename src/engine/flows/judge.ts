// src/engine/judge-flow.ts
// 判定结算编排函数(对齐 出牌流程重设计.md 模块 H / judge.md)。
//
// 将判定流程拆为「判定时 → 翻牌(判定 atom)→ 生效前 → 生效后」时机标记 atom,
// 与 runUseFlow / runDamageFlow / runDeathFlow / runMoveCardFlow 一致的
// 「编排函数 + 时机标记 atom」模式。
//
// 模块 H 已完成接入:
//   - 判定时:咒缚 before-hook 可替换判定牌来源。
//   - 判定牌生效前:鬼才/鬼道 改判(本 atom afterApply 调 runJudgeModifiers)。
//   - 判定牌生效后:天妒/洛神/屯田 获得判定牌 / 闪电·乐不思蜀 等消费方 after-hook 读牌。
//   - 判定 atom 已瘦身为纯翻牌(apply),改判/消费/清理逻辑均迁出至本编排函数。
//
// 判定结果回传:收尾步骤把最终判定牌 cardId 写入
// state.localVars['判定/finalJudgeCardId'],调用方据此读取判定结果。runJudgeFlow 返回该 cardId。
import type { GameState } from '../types';
import { applyAtom } from '../index';

/** runJudgeFlow 收尾回写最终判定牌 cardId 的 localVars 键(与 cleanupJudgeCard 一致)。 */
const JUDGE_FINAL_CARD_KEY = '判定/finalJudgeCardId';

/** 判定结算编排函数——对齐 judge.md / 出牌流程重设计.md 模块 H 四时机。
 *
 *  时机1 判定时:咒缚 before-hook 可替换判定牌来源。
 *  时机2 判定(翻牌):底层操作,牌堆顶→结算帧牌区。
 *  时机3 判定牌生效前:鬼才/鬼道 改判(afterApply 调 runJudgeModifiers,逆时针从目标起,
 *    直接 mutate 结算帧顶牌)。
 *  时机4 判定牌生效后:天妒/洛神/屯田 获得判定牌 / 闪电·乐不思蜀 等消费方 after-hook 读牌。
 *  收尾:记录最终判定牌 cardId 到 localVars,再把判定牌从结算帧移入弃牌堆
 *    (天妒/屯田 可能已在 生效后 拿走 → splice 为 no-op,但仍记录 cardId)。
 *
 *  返回最终判定牌 cardId(可能被改判替换),供调用方读取判定结果。
 *  牌堆为空(判定 atom apply 早退,未翻牌)时返回 undefined。
 *
 *  @param state     游戏状态
 *  @param player    判定目标(座次下标)
 *  @param judgeType 判定类型(乐不思蜀/闪电/八卦阵/铁骑 等)
 *  @returns 最终判定牌 cardId(牌堆空时为 undefined) */
export async function runJudgeFlow(
  state: GameState,
  player: number,
  judgeType: string,
): Promise<string | undefined> {
  // 时机1:判定时(咒缚可替换判定牌来源)
  await applyAtom(state, { type: '判定时', player, judgeType });

  // 时机2:翻牌(判定 atom 仅翻牌:牌堆顶→结算帧牌区,无改判/消费/清理)
  await applyAtom(state, { type: '判定', player, judgeType });

  // 读当前判定牌 cardId(结算帧牌区顶;牌堆空时判定.apply 早退,可能无牌)。
  // 注意:此刻改判尚未发生(生效前 在其后);atom.cardId 字段仅供 validate/视图,
  // 消费方读的是结算帧顶牌(改判后),不读此字段。
  const judgeCardId = topFrameCardId(state);

  // 时机3:判定牌生效前(鬼才/鬼道 改判——afterApply 调 runJudgeModifiers)
  await applyAtom(state, { type: '判定牌生效前', player, judgeType, cardId: judgeCardId });

  // 时机4:判定牌生效后(天妒/洛神/屯田 获得判定牌 / 闪电·乐不思蜀 等消费方读牌)
  await applyAtom(state, { type: '判定牌生效后', player, judgeType, cardId: judgeCardId });

  // 收尾:记录最终判定牌(可能被改判替换),再把判定牌从结算帧移入弃牌堆。
  cleanupJudgeCard(state);

  return state.localVars[JUDGE_FINAL_CARD_KEY] as string | undefined;
}

/** 结算帧牌区顶的牌 id(frame 优先,否则 processing);空则 undefined。 */
function topFrameCardId(state: GameState): string | undefined {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  const cards = frame ? frame.cards : state.zones.processing;
  return cards.length > 0 ? cards[cards.length - 1] : undefined;
}

/** 记录最终判定牌到 localVars,并把判定牌从结算帧移入弃牌堆。
 *  天妒/屯田 可能已在 判定牌生效后 把判定牌拿走(结算帧空)→ splice 为 no-op,但仍记录 cardId。 */
function cleanupJudgeCard(state: GameState): void {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  const cards = frame ? frame.cards : state.zones.processing;
  const idx = cards.length - 1;
  if (idx < 0) return;
  const cardId = cards[idx];
  state.localVars[JUDGE_FINAL_CARD_KEY] = cardId;
  cards.splice(idx, 1);
  state.zones.discardPile.push(cardId);
}
