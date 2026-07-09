// src/engine/skip-phase.ts
// 阶段跳过标准化辅助函数。
//
// 背景:兵粮寸断/乐不思蜀/神速/巧变/双雄 等技能都需要在「阶段开始」atom 的
// before-hook 中跳过当前阶段。该过程由三个缺一不可的步骤组成,且顺序关键:
//   1) 去标签(仅标签型跳过需要):否则 阶段结束 推进到下一阶段后,若新阶段又命中
//      同一标签 hook,会导致 hook 重复触发。
//   2) 触发「阶段结束」(当前阶段):让回合管理的 after-hook 把阶段推进到下一阶段。
//      漏掉这一步会令游戏卡死(soft-lock)。
//   3) 返回 cancel:阻止当前「阶段开始」atom 的 apply(默认动作如摸牌不再执行)。
//
// 本函数封装这三步,避免每个技能手动重复、遗忘顺序。
import type { GameState, HookResult } from './types';
import { applyAtom } from './create-engine';

/**
 * 在「阶段开始」atom 的 before-hook 中跳过当前阶段。
 *
 * 用法:
 * ```ts
 * registerBeforeHook(state, skillId, ownerId, '阶段开始', async (ctx) => {
 *   if (shouldSkip) return skipPhase(ctx.state, ctx.atom, cleanupTag);
 * });
 * ```
 *
 * @param state       游戏状态
 * @param atom        触发跳过的「阶段开始」atom(取其 player/phase)
 * @param cleanupTag  可选:跳过前要清除的标签名(标签型跳过,如「兵粮寸断/跳过摸牌」)。
 *                    直接型跳过(如神速①当场跳过判定、巧变弃牌跳过)不传。
 * @returns cancel 结果,直接 `return` 给 before-hook。
 */
export async function skipPhase(
  state: GameState,
  atom: { player: number; phase: string },
  cleanupTag?: string,
): Promise<HookResult> {
  // 1) 去标签(标签型跳过才需要)
  if (cleanupTag !== undefined) {
    await applyAtom(state, { type: '去标签', player: atom.player, tag: cleanupTag });
  }
  // 2) 阶段结束:让回合管理把阶段推进到下一阶段
  await applyAtom(state, { type: '阶段结束', player: atom.player, phase: atom.phase });
  // 3) cancel 当前「阶段开始」atom,阻止其 apply(默认动作不再执行)
  return { kind: 'cancel' };
}
