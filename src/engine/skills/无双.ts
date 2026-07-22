// 无双(吕布·锁定技):
//   1. 你使用【杀】指定一名角色为目标时,该角色需连续使用两张【闪】才能抵消
//   2. 与你进行【决斗】的角色每次需连续打出两张【杀】
//
// 实现方式(杀部分):在「生效前」before-hook 中拦截闪。
//   当闪的「生效前」atom 触发时(cardId 对应的牌为闪):
//   - 找到外层杀帧,检查杀的 source 是否拥有无双
//   - 第一次闪:cancel(闪不生效,不抵消杀)
//   - 第二次闪:pass(闪正常生效,抵消杀)
//   handleSlashDodge 收到 cancel 后会 drain 闪并再次询问,实现"需两张闪"。
//
// 实现方式(决斗部分):enforceDualKill 辅助函数,由决斗 CardEffect.resolve 调用
//   (决斗不走"生效前"闪机制,无双的决斗效果保留为函数调用)。
//
// 八卦阵 FAQ:八卦阵判红放虚拟闪到处理区后,handleSlashDodge 发出闪的「生效前」atom,
// 无双 hook 同样拦截第一次(虚拟闪被 cancel),第二次八卦阵再判一次。

import type { GameState, HookResult, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerBeforeHook } from '../skill';
import { topFrame } from '../create-engine';
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

/** localVars key:无双闪计数器（杀cardId/目标座次） */
function dodgeCountKey(killCardId: string, target: number): string {
  return `无双/dodgeCount/${killCardId}/${target}`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 生效前 before-hook：拦截无双杀的第一次闪 ──
  // 只处理闪的「生效前」（cardId 对应的牌为闪）。
  // 通过外层杀帧判断：杀的 source 是否拥有无双。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '生效前',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom as { target: number; cardId: string; source: number };
      // 只处理闪的生效前
      const card = ctx.state.cardMap[atom.cardId];
      if (!card || card.name !== '闪') return;

      // 从结算帧栈找到外层杀帧（闪的生效前由 handleSlashDodge 发出，
      // 此时栈顶是杀帧——闪没有自己的帧）
      const killFrame = topFrame(ctx.state);
      if (!killFrame) return;
      const killCardId = killFrame.params.cardId as string | undefined;
      if (!killCardId) return;
      const killCard = ctx.state.cardMap[killCardId];
      if (!killCard || killCard.name !== '杀') return;

      // 检查杀的 source 是否拥有无双（ownerId）
      const killSource = killFrame.from;
      if (killSource !== ownerId) return; // 不是我的杀
      if (!ctx.state.players[ownerId]?.skills.includes('无双')) return;

      // 计数器：第一次 cancel，第二次放行
      const countKey = dodgeCountKey(killCardId, atom.target);
      const count = (ctx.state.localVars[countKey] as number) ?? 0;
      if (count < 1) {
        ctx.state.localVars[countKey] = count + 1;
        return { kind: 'cancel' }; // 第一次闪被拦截
      }
      // 第二次闪放行
      delete ctx.state.localVars[countKey];
    },
  );

  return () => {};
}

/**
 * 无双·决斗:若 otherParty(决斗中拥有无双的一方)有无双,消耗处理区已有的全部杀牌,
 * 再追加一次 applyAtom(询问杀)。
 *
 * 在 决斗 CardEffect.resolve 的 applyAtom(询问杀) 之后调用。
 * otherParty 是被询问者(current)的对手 —— 即 询问杀 的 source。
 */
export async function enforceDualKill(
  state: GameState,
  otherParty: number,
  current: number,
): Promise<void> {
  if (!state.players[otherParty]?.skills.includes('无双')) return;
  const firstKills = frameCards(state).filter((id) => state.cardMap[id]?.name === '杀');
  if (firstKills.length === 0) return;
  for (const id of firstKills) {
    await applyAtom(state, {
      type: '移动牌',
      cardId: id,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });
  }
  await applyAtom(state, { type: '询问杀', target: current, source: otherParty });
}

export default { createSkill, onInit } satisfies SkillModule;
