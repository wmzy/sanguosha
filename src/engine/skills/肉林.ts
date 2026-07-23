// 肉林(董卓·锁定技):你对女性角色/女性角色对你使用【杀】时,目标需连续出两张闪才能抵消。
//
// 实现方式:在「询问闪」after-hook 中处理（镜像无双）。
//   询问闪 resolve 后,肉林检测到标记被设置 → 第一次: 清除标记+drain+追加第二次询问。

import type { GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';
import { isCancelled, clearCancelled } from '../card-effect/registry';
import { getGender } from '../character-meta';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '肉林',
    description: '锁定技:你对女性角色/女性角色对你使用【杀】时,目标需连续出两张闪才能抵消',
    isLocked: true,
  };
}

function roulinApplies(state: GameState, source: number, target: number): boolean {
  const src = state.players[source];
  const tgt = state.players[target];
  if (!src || !tgt) return false;
  const srcRoulin = src.skills.includes('肉林');
  const tgtRoulin = tgt.skills.includes('肉林');
  const tgtFemale = getGender(tgt.character) === '女';
  const srcFemale = getGender(src.character) === '女';
  return (srcRoulin && tgtFemale) || (tgtRoulin && srcFemale);
}

function dodgeCountKey(killCardId: string, target: number): string {
  return `肉林/dodgeCount/${killCardId}/${target}`;
}

function getKillCardId(state: GameState): string {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  return (frame?.params?.cardId as string) ?? '';
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 新模型:闪走 runUseFlow,闪牌自动移入弃牌堆;闪 resolve 设杀帧 cancelled=true。
  // 肉林只需清除 cancelled + 追加第二次询问闪;第二次闪 resolve 自动重设 cancelled。
  registerAfterHook(state, skill.id, ownerId, '询问闪', async (ctx) => {
    const atom = ctx.atom as { target: number; source: number };
    // 检查肉林条件
    if (!roulinApplies(ctx.state, atom.source, atom.target)) return;

    const target = atom.target;
    const killCardId = getKillCardId(ctx.state);
    if (!isCancelled(ctx.state, killCardId, target)) return;

    const countKey = dodgeCountKey(killCardId, target);
    const count = (ctx.state.localVars[countKey] as number) ?? 0;
    if (count >= 1) {
      delete ctx.state.localVars[countKey];
      return;
    }

    // 第一次闪:清除 cancelled + 追加第二次询问
    // 闪牌已由 runUseFlow 自动移入弃牌堆,无需手动 drain
    clearCancelled(ctx.state, killCardId, target);
    ctx.state.localVars[countKey] = count + 1;

    await applyAtom(ctx.state, { type: '询问闪', target, source: atom.source });
    delete ctx.state.localVars[countKey];
  });

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
