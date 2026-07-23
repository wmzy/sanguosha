// src/engine/无懈可击.ts
// 通用无懈可击询问 helper。
//
// 规则:无懈对全体锦囊(南蛮/万箭/桃园/五谷)只抵消对特定 1 名角色的效果;
// 对单目标锦囊(过河拆桥/借刀杀人/决斗)抵消整个锦囊。
// 延时锦囊(乐/兵粮/闪电)在判定前询问,抵消整个延时锦囊。
//
// 机制(close-reopen):每个锦囊对每个目标调用 询问无懈可击(state, target):
//   1. 创建一个广播型 请求回应(target=-2 或 ownerId,requestType='无懈可击',cancelTarget=本次抵消目标)
//   2. 任何角色可打出无懈可击;无懈 respond execute 翻转 localVars[`无懈/被抵消/${target}`]
//   3. 有人 respond → slot resolve → 询问无懈可击 循环创建新窗口(新 createdSeq)
//      旧窗口过期 respond 被 pending-scoped 校验拒绝
//   4. 无人 respond(超时)→ 循环结束,返回该目标是否被抵消
//   5. 奇数次无懈 = 被抵消,偶数次 = 恢复生效
//
// 全体锦囊的典型用法(南蛮入侵):
//   for (const t of targets) {
//     const cancelled = await 询问无懈可击(state, t);
//     if (!cancelled) { /* 对 t 结算效果 */ }
//   }
//
// 单目标锦囊(过河拆桥):
//   const cancelled = await 询问无懈可击(state, target);
//   if (!cancelled) { /* 执行效果 */ }
import type { GameState, Json } from './types';
import { TARGET_BROADCAST } from './types';
import { applyAtom } from './create-engine';

/**
 * 询问无懈可击并返回指定目标是否被抵消。
 *
 * 调用方负责判断是否需要询问：
 *   - 虚拟使用（视为使用，无实体牌）不调用本函数；
 *   - 延时锦囊在判定阶段 before-hook 中调用（非 runSettlementPhase）。
 *
 * @param state 游戏状态
 * @param cancelTarget 本次无懈抵消的目标座次:
 *   - 全体锦囊:传具体目标 index(N),每个目标独立询问
 *   - 单目标/延时锦囊:传该锦囊的目标 index
 * @returns 该目标是否被无懈可击抵消(true=被抵消,跳过该目标结算)
 */
export async function 询问无懈可击(state: GameState, cancelTarget: number): Promise<boolean> {
  const key = `无懈/被抵消/${cancelTarget}`;
  const respondedKey = `无懈/已回应/${cancelTarget}`;
  state.localVars[key] = false;
  try {
    while (true) {
      state.localVars[respondedKey] = false;
      await applyAtom(state, {
        type: '请求回应',
        requestType: '无懈可击',
        target: TARGET_BROADCAST,
        cancelTarget,
        prompt: {
          type: 'useCard',
          title: '是否打出无懈可击?',
          cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 },
        },
        timeout: 10,
      });
      // applyAtom 返回 = 窗口超时(无人 respond)或被 respond resolve。
      // 本次窗口是否有人 respond? (await 期间可能被 respond execute 修改)
      const responded = (state.localVars[respondedKey] as Json) === true;
      if (!responded) break;
      // 有人打了无懈 → 循环开新窗口(新 createdSeq),让其他人反无懈
    }
    return (state.localVars[key] as Json) === true;
  } finally {
    delete state.localVars[key];
    delete state.localVars[respondedKey];
  }
}
