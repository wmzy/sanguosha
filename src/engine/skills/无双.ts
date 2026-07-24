// 无双(吕布·锁定技):
//   1. 你使用【杀】指定一名角色为目标时,该角色需连续使用两张【闪】才能抵消
//   2. 与你进行【决斗】的角色每次需连续打出两张【杀】
//
// 实现方式(杀部分):在「询问闪」after-hook 中处理。
//   闪 skill 的 生效前 after-hook 发出 询问闪 → 目标 respond(出闪,设置标记+移牌) →
//   询问闪 resolve → 无双的 询问闪 after-hook 检测到标记被设置 →
//   第一次: 清除标记 + drain闪 + 追加第二次询问闪。
//   第二次: 放行(标记保持设置)。
//
// 选择 询问闪 after-hook(而非 生效前 after-hook)的原因:
//   生效前 after-hook 按注册顺序执行——P1 的无双 hook 先于 P2 的闪 hook(P1 先实例化)。
//   询问闪 after-hook 在 询问闪 resolve 时触发,此时闪的 respond action 已设置标记。

import type { GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';
import { isCancelled, clearCancelled } from '../card-effect/registry';
import { consumePlayedSlashes } from '../card-effect/play-card';
import type { SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '无双',
    description: '锁定技:你使用【杀】的目标需连续出两张【闪】才能抵消;与你【决斗】的角色每次需连续打出两张【杀」',
    isLocked: true,
  };
}

function dodgeCountKey(killCardId: string, target: number): string {
  return `无双/dodgeCount/${killCardId}/${target}`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 询问闪 after-hook:无双杀的目标出闪后,拦截第一次 ──
  // 新模型:闪走 runUseFlow,闪牌自动移入弃牌堆;闪 resolve 设杀帧 cancelled=true。
  // 无双只需清除 cancelled + 追加第二次询问闪;第二次闪 resolve 自动重设 cancelled。
  registerAfterHook(state, skill.id, ownerId, '询问闪', async (ctx) => {
    const atom = ctx.atom as { target: number; source: number };
    // 检查杀的 source 是否拥有无双(ownerId)
    if (atom.source !== ownerId) return;
    if (!ctx.state.players[ownerId]?.skills.includes('无双')) return;

    const target = atom.target;
    // 闪的 resolve 已设杀帧 cancelled=true;未出闪则不拦截
    if (!isCancelled(ctx.state, getKillCardId(ctx.state), target)) return;

    // 计数器
    const killCardId = getKillCardId(ctx.state);
    const countKey = dodgeCountKey(killCardId, target);
    const count = (ctx.state.localVars[countKey] as number) ?? 0;
    if (count >= 1) {
      // 第二次闪:放行(cancelled 保持 true)
      delete ctx.state.localVars[countKey];
      return;
    }

    // 第一次闪:清除 cancelled + 追加第二次询问
    // 闪牌已由 runUseFlow 自动移入弃牌堆,无需手动 drain
    clearCancelled(ctx.state, killCardId, target);
    ctx.state.localVars[countKey] = count + 1;

    // 追加第二次询问闪:玩家出第二张闪 → resolve 自动设 cancelled;超时 → cancelled 保持 false
    await applyAtom(ctx.state, { type: '询问闪', target, source: ownerId });
    delete ctx.state.localVars[countKey];
  });

  return () => {};
}

/** 从结算帧栈顶部找到杀的 cardId */
function getKillCardId(state: GameState): string {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  return (frame?.params?.cardId as string) ?? '';
}

/**
 * 无双·决斗:若 otherParty(决斗中拥有无双的一方)有无双,消耗处理区已有的全部杀牌,
 * 再追加一次 applyAtom(询问杀)。
 */
export async function enforceDualKill(
  state: GameState,
  otherParty: number,
  current: number,
): Promise<void> {
  if (!state.players[otherParty]?.skills.includes('无双')) return;
  const firstKills = await consumePlayedSlashes(state);
  if (firstKills.length === 0) return;
  await applyAtom(state, { type: '询问杀', target: current, source: otherParty });
}

export default { createSkill, onInit } satisfies SkillModule;
