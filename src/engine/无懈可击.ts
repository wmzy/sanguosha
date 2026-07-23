// src/engine/无懈可击.ts
// 通用抵消询问 helper —— 统一闪/无懈可击的抵消机制。
//
// 闪抵消杀：定向询问杀目标是否出闪（broadcast=false）
// 无懈可击抵消锦囊：广播询问所有玩家是否出无懈可击（broadcast=true）
// 无懈可击抵消无懈可击：同上（无懈可击本身是锦囊，runSettlementPhase 自动推导）
//
// 机制（close-reopen + 结算帧栈）：
//   本函数操作栈顶帧的 cancelled 字段。
//   抵消牌（闪/无懈）走 runUseFlow → resolve 时设下层帧(stack[length-2]).cancelled=true。
//   循环：创建询问 → 等待 respond → 检查 frame.cancelled：
//   - 无人 respond（超时）→ 退出
//   - 有人 respond 且抵消牌生效 → frame.cancelled=true → 退出
//   - 有人 respond 但抵消牌被反抵消 → frame.cancelled=false → 继续循环（close-reopen）
//
// 典型用法（runSettlementPhase 的「生效前」后）：
//   const cancellable = effect.cancelledBy ?? (card?.type === '锦囊牌' ? { cardName:'无懈可击', broadcast:true } : undefined);
//   if (cancellable) await 询问抵消(state, cancellable, source, target);
//
// 延时锦囊场景：判定阶段 before-hook 中 pushFrame 后调用本函数。
import type { GameState, Json, SettlementFrame } from './types';
import { TARGET_BROADCAST } from './types';
import { applyAtom } from './create-engine';
import type { CancellableBy } from './card-effect/registry';

const RESPONDED_KEY = '抵消/已回应';

/**
 * 询问抵消并返回栈顶帧是否被抵消。
 *
 * 调用方负责 pushFrame（栈顶帧即被抵消的牌的结算帧）。
 * 抵消牌的 respond action 走 runUseFlow，resolve 时设下层帧 cancelled=true；
 * 本函数通过 RESPONDED_KEY localVars 标记判断是否有人 respond。
 *
 * @param config  抵消配置（cardName + broadcast）
 * @param source  被抵消牌的使用者
 * @param target  被抵消牌的目标座次（定向询问时 = 杀目标；广播时 = 锦囊目标）
 * @returns 栈顶帧是否被抵消
 */
export async function 询问抵消(
  state: GameState,
  config: CancellableBy,
  source: number,
  target: number,
): Promise<boolean> {
  // broadcast=false（闪）：无 close-reopen。闪不能被闪抵消，无双/肉林在询问闪 after-hook 中
  // 自行管理额外询问（清除 cancelled + 追加第二次询问闪）。
  if (!config.broadcast) {
    state.localVars[RESPONDED_KEY] = false;
    await applyAtom(state, { type: '询问闪', target, source });
    // 八卦阵等虚拟闪不走 runUseFlow，直接把虚拟闪放入处理区。
    // 检测处理区中的闪牌，设帧 cancelled 并 drain（镜像旧 registerDodgeHook 逻辑）。
    if (!isFrameCancelled(state)) {
      const frame = state.settlementStack[state.settlementStack.length - 1];
      const dodgeIds = (frame ? frame.cards : state.zones.processing)
        .filter((id) => state.cardMap[id]?.name === '闪');
      if (dodgeIds.length > 0 && frame) {
        frame.cancelled = true;
        for (const id of dodgeIds) {
          await applyAtom(state, {
            type: '移动牌',
            cardId: id,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
      }
    }
    delete state.localVars[RESPONDED_KEY];
    return isFrameCancelled(state);
  }

  // broadcast=true（无懈可击）：close-reopen 循环。
  while (true) {
    state.localVars[RESPONDED_KEY] = false;
    await applyAtom(state, {
        type: '请求回应',
        requestType: config.cardName,
        target: TARGET_BROADCAST,
        cancelTarget: target,
        prompt: {
          type: 'useCard',
          title: `是否打出${config.cardName}?`,
          cardFilter: { filter: (c) => c.name === config.cardName, min: 1, max: 1 },
        },
        timeout: 10,
      });
    const responded = (state.localVars[RESPONDED_KEY] as Json) === true;
    if (!responded) break; // 无人 respond（超时）
    // 每次循环重新读栈顶帧的 cancelled（resolve 跨 await 修改，TS 无法跟踪）
    if (isFrameCancelled(state)) break; // 抵消牌生效，当前帧被抵消
    // respond 但被反抵消 → 继续循环（close-reopen）
  }
  delete state.localVars[RESPONDED_KEY];
  return isFrameCancelled(state);
}

/** 读取栈顶帧 cancelled。每次重新索引避免 TS 类型窄化（跨 await mutation 不可跟踪）。 */
function isFrameCancelled(state: GameState): boolean {
  const arr = state.settlementStack as unknown as { cancelled: boolean }[];
  const f = arr[arr.length - 1];
  return f ? (f.cancelled as boolean) === true : false;
}
