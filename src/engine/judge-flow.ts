// src/engine/judge-flow.ts
// 判定结算编排函数(对齐 flow-redesign.md 模块 H / judge.md)。
//
// 将判定流程拆为「判定时 → 翻牌(判定 atom)→ 生效前 → 生效后」时机标记 atom,
// 与 runUseFlow / runDamageFlow / runDeathFlow / runMoveCardFlow 一致的
// 「编排函数 + 时机标记 atom」模式。
//
// 当前接入范围(模块 H 最小改动):
//   - 只在 判定 atom 之前发出 判定时 时机(咒缚 before-hook 可替换判定牌来源)。
//   - 不重构 判定 atom 内部:apply(翻牌)+ afterApply(runJudgeModifiers 改判)+
//     afterHooks(消费+移弃牌堆)保持不变。
//   - 不迁移现有技能 hook:鬼才/鬼道仍用 runJudgeModifiers,天妒/洛神/屯田仍用 判定 after-hook。
//   - 判定牌生效前/判定牌生效后 atom 已定义(judge-timing.ts),暂不在此发出——
//     避免与现有 判定.afterApply/afterHooks 的改判/消费逻辑重复触发。
//     待 hook 迁移完成后再接入(届时 判定 atom 的 afterApply/afterHooks 改判/消费逻辑一并迁出)。
//
// 判定结果回传:判定 atom 的 afterHooks 把最终判定牌 cardId 写入
// state.localVars['判定/finalJudgeCardId'],调用方据此读取判定结果。runJudgeFlow 返回该 cardId。
import type { GameState } from './types';
import { applyAtom } from './create-engine';

/** 判定 atom 的 afterHooks 回写最终判定牌 cardId 的 localVars 键(与 判定.ts 保持一致)。 */
const JUDGE_FINAL_CARD_KEY = '判定/finalJudgeCardId';

/** 判定结算编排函数——对齐 judge.md 时机。
 *
 *  在 判定 atom(翻牌 + 改判 + 消费)之前发出 判定时 时机标记,供「判定开始前」类
 *  技能(咒缚替换判定牌来源)挂 before-hook。判定 atom 内部的翻牌/改判/消费逻辑保持不变。
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

  // 翻牌 + 改判(判定.afterApply 的 runJudgeModifiers)+ 消费+移弃牌堆(判定.afterHooks)
  await applyAtom(state, { type: '判定', player, judgeType });

  // 读判定 atom afterHooks 回写的最终判定牌 cardId(可能被改判替换)
  return state.localVars[JUDGE_FINAL_CARD_KEY] as string | undefined;
}
