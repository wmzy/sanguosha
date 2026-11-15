// src/client/utils/skipMessage.ts
// skip 兜底消息的单一构造点。广播型 pending(无懈可击)全员 skip 累计、无头客户端
// pass、无头枚举的 skip 动作、浏览器「不回应」与自动跳过(useAutoSkip)都发同一
// 形态的消息——此前 5 处各自手写 `{ skillId: '__skip', actionType: 'skip', ... }`,
// 引擎按 skillId==='__skip' 路由超时累计,改一处漏四处风险高,故收敛于此。
// (HeadlessGameClient 内对已发 skip 的比对也走 SKIP_SKILL_ID,同一真相。)
import type { ClientMessage } from '../../engine/types';

/** skip 兜底动作的 skillId(引擎按它路由,勿改字面量) */
export const SKIP_SKILL_ID = '__skip';
/** skip 兜底动作的 actionType */
export const SKIP_ACTION_TYPE = 'skip';

/** 完整 skip 消息(无头枚举 skipMessage / HeadlessGameClient.pass 共用)。 */
export function buildSkipMessage(ownerId: number): ClientMessage {
  return {
    skillId: SKIP_SKILL_ID,
    actionType: SKIP_ACTION_TYPE,
    ownerId,
    params: {},
    baseSeq: 0,
  };
}
