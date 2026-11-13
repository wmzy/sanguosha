// src/engine/atoms/请求回应.ts
// 请求回应:通用等待型 atom — 等待 target 玩家回应
// src/engine/atoms/请求回应.ts
// 请求回应:通用等待型 atom — 等待 target 玩家回应
import type { ActionPrompt, AtomDefinition, Card, Json, ViewEventSplit } from '../types';
import { broadcast } from './_helpers';

import { applyAtom } from '../core/apply';
import { handLimit } from '../rules/hand-limit';
import { cardResponsePreResolveForTarget } from '../core/card-response-availability';

/** 弃牌超时兜底的保留优先级表(桃:0 杀:1 闪:2 无懈可击:3,值越小越优先保留;
 *  未列出的牌按 9 处理,优先被弃)。客户端 GameView 的弃牌预览高亮 import 此常量,
 *  与引擎超时自动弃置必须同一排序(低价值先弃,与手牌位置无关)。 */
export const DISCARD_KEEP_PRIORITY: Record<string, number> = {
  '桃': 0,
  '杀': 1,
  '闪': 2,
  '无懈可击': 3,
};

/** 请求回应 的卡牌回应 filter:仅 useCard+cardFilter.filter 的非 mandatory 回应。
 *  其他(confirm / choosePlayer / distribute / pickTargetCard / mandatory 等)返回 null → 正常询问。
 *  type-safe:仅依赖 atom 的 prompt/mandatory/target 字段(均在 A 参数型内)。 */
function responseCardFilter(atom: {
  mandatory?: boolean;
  prompt: ActionPrompt;
}): ((card: Card) => boolean) | null {
  if (atom.mandatory === true) return null;
  // prompt 在类型上可缺省(旧构造路径):无 prompt = 无卡牌过滤,按 normal 询问。
  if (atom.prompt?.type !== 'useCard') return null;
  const filter = atom.prompt.cardFilter?.filter;
  return typeof filter === 'function' ? filter : null;
}

export const 请求回应: AtomDefinition<{
  requestType: string;
  target: number;
  prompt: ActionPrompt;
  defaultChoice?: Json;
  /** 超时秒数:覆盖 pending.timeout(无懈可击=10,默认 30) */
  timeout?: number;
  /** 无懈可击抵消目标座次(仅 requestType='无懈可击' 时存在) */
  cancelTarget?: number;
  /** 强制型回应(如英魂弃牌):前端隐藏"不回应"按钮 + 走多牌选择 UI,headless 不生成 skip。
   *  超时后由调用方(技能自身)负责 auto-discard——请求回应.onTimeout 对 mandatory 不做处理。 */
  mandatory?: boolean;
}> = {
  type: '请求回应',
  validate(state, atom) {
    // target===TARGET_SYSTEM(-1)和 target===TARGET_BROADCAST(-2)是合法的特殊值
    if (atom.target < 0) return null;
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    // 超时处理:按 requestType 分发
    async onTimeout(state, atom) {
      // 弃牌询问超时:自动弃超出手牌(逆序)
      if (atom.requestType === '__弃牌') {
        const target = atom.target;
        const p = state.players[target];
        if (!p) return;
        // 手牌上限统一经 hand-limit 计算(支持覆盖型提供者,如界英姿「手牌上限=体力上限」)
        const limit = handLimit(state, target);
        if (p.hand.length <= limit) return;
        const excess = p.hand.length - limit;
        // 超时自动弃牌：保留高价值牌（桃/杀/闪/无懈可击），弃掉低优先级牌。
        // 避免盲弃末尾导致关键牌丢失，与 AI 玩家弃牌策略一致。
        // 降序排列：低价值牌（priority 值大）排在前面，优先被弃
        const sorted = [...p.hand].sort((a, b) => {
          const ca = state.cardMap[a];
          const cb = state.cardMap[b];
          return (DISCARD_KEEP_PRIORITY[cb?.name ?? ''] ?? 9) - (DISCARD_KEEP_PRIORITY[ca?.name ?? ''] ?? 9);
        });
        const toDiscard = sorted.slice(0, excess);
        await applyAtom(state, { type: '弃置', player: target, cardIds: toDiscard });
        return;
      }
      // 其他 requestType 超时:无操作
    },
    prompt: { type: 'confirm', title: '请回应' },
    timeout: 30,
    // 卡牌回应型预检(仅 useCard+cardFilter.filter 的非广播/非强制回应生效):
    //   无手牌→skip;有手牌无匹配牌→silent(短延时,不被询问);有匹配牌→正常。
    //   confirm/choosePlayer/distribute/pickTargetCard/mandatory 等非卡牌回应型 → 正常询问。
    preResolve: (state, atom) => {
      // 广播型(target<0,如无懈可击)不参与:任何人可回应,不能据某一座次手牌跳过。
      if (atom.target < 0) return null;
      const filter = responseCardFilter(atom);
      if (!filter) return null;
      return cardResponsePreResolveForTarget(state, '请求回应', atom.target, filter, atom.requestType);
    },
  },
  effect: { blockUntilDone: true, duration: 200 },
  toViewEvents(_state, atom): ViewEventSplit {
    // Prompts/candidates belong only to the per-viewer authoritative pending envelope.
    return broadcast({ type: '请求回应', requestType: atom.requestType, target: atom.target });
  },
};
