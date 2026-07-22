// 魂姿(孙策·觉醒技):准备阶段,若你的体力值为1,
//   你须减1点体力上限,并永久获得技能"英姿"和"英魂"。
//
// 模式(觉醒技,强制):after hook 挂在「阶段开始」(phase='准备')。
//   准备阶段(player===ownerId) → 体力为1 且未觉醒 → 强制结算:
//     1. 减1点体力上限(设上限 amount=maxHealth-1;设上限会 clamp 体力,
//        当前体力1 ≤ 新上限3,体力保持1)
//     2. 永久获得"英姿"(添加技能 skillId='英姿')
//     3. 永久获得"英魂"(添加技能 skillId='英魂')
//   觉醒标记:player.vars['魂姿/awakened'](后缀不含 usedThisTurn,整局一次,
//     不被「回合结束」自动清理)
//
// 关键点:
//   - 觉醒技:整局一次,强制发动(无询问)
//   - 触发时机:文档「准备阶段」,挂在「阶段开始」phase='准备'
//   - 体力条件:文档「体力为1」,严格判断 health===1
//   - 技能实例归属:添加技能 atom 触发 系统规则 after-hook → instantiateSkill,
//     英姿/英魂 以 ownerId=孙策座次 实例化,内部用 skill.ownerId 工作,归属正确
//   - 英姿/英魂 已实现(周瑜·英姿、孙坚·英魂),直接挂载
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

const AWAKENED_KEY = '魂姿/awakened';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '魂姿',
    description: '觉醒技:准备阶段且体力为1时,减1体力上限并永久获得"英姿"和"英魂"',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    // 仅准备阶段触发(文档「准备阶段」)
    if (atom.phase !== '准备') return;
    // 觉醒技:整局一次
    if (ctx.state.players[ownerId]?.vars[AWAKENED_KEY]) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 体力条件:文档「体力为1」
    if (self.health !== 1) return;

    // 标记已觉醒(在读条件后立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 减1点体力上限(设上限 clamp 体力:当前1 ≤ 新上限,体力保持1)
    await applyAtom(ctx.state, {
      type: '设上限',
      player: ownerId,
      amount: self.maxHealth - 1,
    });

    // 2. 永久获得"英姿"
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '英姿' });

    // 3. 永久获得"英魂"
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '英魂' });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 觉醒技,被动触发,无主动 action
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
