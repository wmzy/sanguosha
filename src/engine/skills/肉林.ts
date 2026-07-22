// 肉林(董卓·锁定技):你对女性角色/女性角色对你使用【杀】时,目标需连续出两张闪才能抵消。
//
// 实现方式:在「生效前」before-hook 中拦截闪（镜像无双）。
//   当闪的「生效前」atom 触发时(cardId 对应的牌为闪):
//   - 找到外层杀帧,检查肉林条件（source/target 拥有肉林+异性）
//   - 第一次闪:cancel(闪不生效)
//   - 第二次闪:pass(闪正常生效)
//
// 触发条件(任一):
//   - 肉林拥有者(董卓)作为杀的 source,且 target 为女性 → target 需双闪
//   - 肉林拥有者(董卓)作为杀的 target,且 source 为女性 → target(董卓)需双闪

import type { GameState, HookResult, Skill } from '../types';
import { registerBeforeHook } from '../skill';
import { topFrame } from '../create-engine';
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

/** 肉林是否适用于此 source→target 的杀结算 */
function roulinApplies(state: GameState, source: number, target: number): boolean {
  const src = state.players[source];
  const tgt = state.players[target];
  if (!src || !tgt) return false;
  const srcRoulin = src.skills.includes('肉林');
  const tgtRoulin = tgt.skills.includes('肉林');
  const tgtFemale = getGender(tgt.character) === '女';
  const srcFemale = getGender(src.character) === '女';
  // 董卓(肉林)对女性使用杀,或女性对董卓(肉林)使用杀
  return (srcRoulin && tgtFemale) || (tgtRoulin && srcFemale);
}

/** localVars key:肉林闪计数器（杀cardId/目标座次） */
function dodgeCountKey(killCardId: string, target: number): string {
  return `肉林/dodgeCount/${killCardId}/${target}`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

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

      // 从结算帧栈找到外层杀帧
      const killFrame = topFrame(ctx.state);
      if (!killFrame) return;
      const killCardId = killFrame.params.cardId as string | undefined;
      if (!killCardId) return;
      const killCard = ctx.state.cardMap[killCardId];
      if (!killCard || killCard.name !== '杀') return;

      const killSource = killFrame.from;
      const killTarget = atom.target; // 闪的使用者 = 杀的目标

      // 检查肉林条件
      if (!roulinApplies(ctx.state, killSource, killTarget)) return;

      // 计数器：第一次 cancel，第二次放行
      const countKey = dodgeCountKey(killCardId, killTarget);
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

export default { createSkill, onInit } satisfies import('../types').SkillModule;
