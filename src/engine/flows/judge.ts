// 判定编排:结果绑定本次调用,不写公共 params/localVars。
import type { Atom, GameState } from '../types';
import { applyAtom } from '../core/apply';
import { frameCards } from '../core/frame';

interface JudgeResult {
  cardId?: string;
  cards?: string[];
}

// 仅存在于流程执行期间；atomHistory/settlementStack 不携带私有结果。
const results = new WeakMap<object, JudgeResult>();

/** 翻牌 atom 在真正 apply 时绑定结果,不能在 await 后猜测全局帧顶。 */
export function bindJudgeCard(atom: object, cardId: string, cards: string[]): void {
  const result = results.get(atom);
  if (result) {
    result.cardId = cardId;
    result.cards = cards;
  }
}

function activeJudgeResult(state: GameState): JudgeResult | undefined {
  for (let i = state.atomStack.length - 1; i >= 0; i--) {
    const result = results.get(state.atomStack[i]);
    if (result) return result;
  }
  return undefined;
}

/** 当前判定流程在 hook 内的稳定结果。仅供判定相关 hook 读取，不写入 public frame/params。 */
export function currentJudgeCardId(state: GameState): string | undefined {
  return activeJudgeResult(state)?.cardId;
}
/** 四时机:判定时 → 翻牌 → 生效前(改判) → 生效后(消费)。
 * 返回本次最终判定牌；消费 hook 收走它或触发嵌套判定均不改变返回值。
 * 没有翻牌时返回 undefined,绝不借用帧中先前的牌。 */
export async function runJudgeFlow(
  state: GameState,
  player: number,
  judgeType: string,
): Promise<string | undefined> {
  const result: JudgeResult = {};
  const flip: Atom = { type: '判定', player, judgeType };
  const before: Atom = { type: '判定牌生效前', player, judgeType };
  const after: Atom = { type: '判定牌生效后', player, judgeType };
  results.set(flip, result);
  results.set(before, result);
  results.set(after, result);
  try {
    await applyAtom(state, { type: '判定时', player, judgeType });
    await applyAtom(state, flip);
    before.cardId = result.cardId;
    await applyAtom(state, before);
    after.cardId = result.cardId;
    await applyAtom(state, after);
    const finalCardId = result.cardId;
    await cleanupJudgeCard(state, result);
    return finalCardId;
  } finally {
    results.delete(flip);
    results.delete(before);
    results.delete(after);
  }
}

/** 改判的两次移动均走 atom,同步手牌数/处理区/弃牌堆。 */
export async function replaceJudgeCard(
  state: GameState,
  ownerId: number,
  replaceCardId: string,
): Promise<void> {
  const result = activeJudgeResult(state);
  const cur = result?.cards ?? frameCards(state);
  const originalJudgeId = result ? result.cardId : cur[cur.length - 1];
  if (originalJudgeId === undefined || !cur.includes(originalJudgeId)) return;
  await applyAtom(state, {
    type: '移动牌',
    cardId: originalJudgeId,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
  });
  await applyAtom(state, {
    type: '移动牌',
    cardId: replaceCardId,
    from: { zone: '手牌', player: ownerId },
    to: { zone: '处理区' },
  });
  if (result) result.cardId = replaceCardId;
}

/** 按本次判定的稳定牌区引用和 cardId 清理,收走后为 no-op。 */
async function cleanupJudgeCard(state: GameState, result: JudgeResult): Promise<void> {
  if (result.cardId === undefined || !result.cards?.includes(result.cardId)) return;
  await applyAtom(state, {
    type: '移动牌',
    cardId: result.cardId,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
  });
}
