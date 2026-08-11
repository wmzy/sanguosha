// core/timeout.ts — pending 超时毫秒数计算(无内部依赖)。
import type { GameState } from '../types';

/** 计算应用了房间配置后的 pending 超时毫秒数。
 *  timeoutSec 为绝对秒数(房间配置):正值=秒数,0=无限(返回 24h,定时器实际不触发)。
 *  未配置 timeoutSec(旧 state/测试)时回退到 atom 的 baseSeconds。
 *  slot 创建(createAndAwaitSlot)与 view deadline(applyView/toViewEvents)共用此函数,
 *  保证后端真实定时器与前端倒计时口径一致。 */
export function resolveTimeoutMs(state: GameState, baseSeconds: number, isBroadcast = false): number {
  const cfg = state.config?.timeoutSec;
  // setTimeout 的 delay 参数上限为 2^31-1 ms(32 位有符号整数)。
  // 超出会触发 TimeoutOverflowWarning 并被截断为 1ms,导致 pending 立即超时。
  // 24 小时 = 86_400_000ms,远低于上限且对游戏而言等效于无限。
  const MAX_TIMEOUT_MS = 86_400_000;
  // 未配置(旧 state/测试):用 atom 的 baseSeconds
  if (cfg === undefined) return Math.min(baseSeconds * 1000, MAX_TIMEOUT_MS);
  // 0 = 无限
  if (cfg <= 0) {
    // 广播型 pending(如无懈可击)不受无限影响:使用 base timeout,避免单座次场景死锁
    if (isBroadcast) return Math.min(baseSeconds * 1000, MAX_TIMEOUT_MS);
    return MAX_TIMEOUT_MS;
  }
  return Math.min(cfg * 1000, MAX_TIMEOUT_MS);
}
