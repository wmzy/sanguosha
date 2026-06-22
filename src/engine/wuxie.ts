// src/engine/wuxie.ts
// 通用无懈可击询问 helper。
//
// 规则:无懈对全体锦囊(南蛮/万箭/桃园/五谷)只抵消对特定 1 名角色的效果;
// 对单目标锦囊(过河拆桥/借刀杀人/决斗)抵消整个锦囊。
// 延时锦囊(乐/兵粮/闪电)在判定前询问,抵消整个延时锦囊。
//
// 机制:每个锦囊对每个目标调用 askWuxie(state, target):
//   1. 创建一个广播型 请求回应(target=-2,requestType='无懈可击',wuxieTarget=本次抵消目标)
//   2. 任何角色可打出无懈可击;无懈 respond execute 翻转 localVars[`无懈/被抵消/${target}`]
//   3. 嵌套反无懈:无懈 respond 调 slot.resume() 保持窗口,直到超时
//   4. 超时后返回该目标是否被抵消
//
// 全体锦囊的典型用法(南蛮入侵):
//   for (const t of targets) {
//     const cancelled = await askWuxie(state, t);
//     if (!cancelled) { /* 对 t 结算效果 */ }
//   }
//
// 单目标锦囊(过河拆桥):
//   const cancelled = await askWuxie(state, target);
//   if (!cancelled) { /* 执行效果 */ }
import type { GameState, Json } from './types';
import { applyAtom } from './create-engine';

/**
 * 询问无懈可击并返回指定目标是否被抵消。
 *
 * @param state 游戏状态
 * @param wuxieTarget 本次无懈抵消的目标座次:
 *   - 全体锦囊:传具体目标 index(N),每个目标独立询问
 *   - 单目标/延时锦囊:传该锦囊的目标 index
 * @returns 该目标是否被无懈可击抵消(true=被抵消,跳过该目标结算)
 */
export async function askWuxie(state: GameState, wuxieTarget: number): Promise<boolean> {
  const key = `无懈/被抵消/${wuxieTarget}`;
  state.localVars[key] = false;
  try {
    await applyAtom(state, {
      type: '请求回应',
      requestType: '无懈可击',
      target: -2,
      wuxieTarget,
      prompt: {
        type: 'useCard',
        title: '是否打出无懈可击?',
        cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 },
      },
      timeout: 10,
    });
    // localVars 是 Record<string, Json>,无懈 respond execute 可能翻转为 true
    return (state.localVars[key] as Json) === true;
  } finally {
    delete state.localVars[key];
  }
}