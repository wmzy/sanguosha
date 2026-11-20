// core/index.ts — 引擎门面 API(纯 re-export + 两个薄包装)。
// 消费者(session 层)通过顶层 engine/index.ts re-export 访问门面 API。
// 内部消费者(skills/atoms/card-effects)直接 import core/apply, core/frame 等。
// 实现已按职责拆出(逐字搬移,导出面与签名不变,import 方零改动):
//   create/bootstrap/registerSkillsFromState + 规则包装载 → ./create
//   dispatch 本体 + 目标形状归一/skip 槽位解析等私属 helper → ./dispatch
import type { GameState, GameView } from '../types';
import { buildView as buildViewImpl } from '../view/buildView';

export {
  resolveGameMode,
  checkGameOver,
  create,
  bootstrap,
  registerSkillsFromState,
} from './create';
export type { GameConfig } from './create';

export { dispatch } from './dispatch';
export type { DispatchResult } from './dispatch';

// restore 重放 + 旧日志兜底(autoSkipLingeringBroadcast)已拆至 core/restore.ts。
// 本模块与 restore.ts 互为循环依赖(restore 重放需调 dispatch):双方均只在函数体内
// 互调,无顶层求值,ESM 活绑定安全。导出签名不变,import 方零改动。
export { restore } from './restore';

/**
 * 稳定点(测试/AI 等待用):等价于旧的「等到 execute 挂起或跑完」,但不轮询。
 * 所有 active run 都已完成或重新挂到 PendingSlot 上时 resolve。
 * (原纯别名 whenEngineIdle 已删,直接导出 run-tracker 本名。)
 */
export { whenIdle } from './run-tracker';

/**
 * 构造指定 viewer 视角的 GameView。
 */
export function buildView(state: GameState, viewer: number, debug = false): GameView {
  return buildViewImpl(state, viewer, debug);
}

/**
 * 立即触发当前 pending slot 的 onTimeout(模拟超时,绕过真实 setTimeout)。
 * 触发后 slot resolve → 父 execute 恢复。广播由 applyAtom 内部的 onStateChange 驱动。
 */
export async function fireTimeout(state: GameState): Promise<void> {
  // 触发所有活跃 slot 的 onTimeout。串行执行:多个 slot 超时可能并行 mutate state
  // (如两个 __弃牌 slot 同时读 players[p].hand 后同时调弃置 → 数据竞争)。
  // 串行避免该问题,且超时本身不属于热路径(测试/调试使用),性能不是首要考虑。
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return;
  for (const s of slots) {
    await s._fireTimeoutNow?.();
  }
}
