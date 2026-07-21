// 救援(孙权·主公技):
//   主公技,锁定技,其他吴势力角色对你使用【桃】的回复值+1。
//   (官方裁定:"你"=孙权=桃的目标,即孙权本人多回1点体力)
//
// 模式 A(被动触发):after hook 挂在「回复体力」。
//   回复体力(target=孙权 + source=其他吴角色 + 濒死求桃救援中 + 孙权为主公)
//   → 对孙权(目标)额外 回复体力 +1。
//
// 关键点:
//   - 主公技:仅孙权为主公(ownerId===0,主公固定 0 号位,见 选将.ts)时生效。
//     参考激将/若愚的主公判定。非主公座次时 hook 注册但不触发。
//   - "其他吴势力角色对你使用【桃】的回复值+1":引擎濒死求桃流程(系统规则.runDyingFlow)
//     在有人出桃救援时 apply 回复体力{target=濒死者=孙权, source=救援者}。
//     桃/酒/急救.respond 均 设 localVars['求桃/已救']=true,runDyingFlow 在 applyAtom
//     返回后才清除此标志,故本 after-hook 执行时该标志仍为 true——以此精确识别
//     "濒死求桃救援"场景。
//   - "其他吴势力角色":source 须 ≠ 孙权 且 faction==='吴'(孙权自救不触发,见 FAQ)。
//   - "回复值+1":对孙权(ownerId)再 apply 回复体力 +1(受 maxHealth 钳制)。
//   - 描述无"可以",故为锁定触发,无询问、无次数限制。
//   - 嵌套安全:bonus 回复体力不携带 source 字段,故 hook 内 `typeof source !== 'number'`
//     早退条件会阻止再次触发(桃/救援加成的区分依据)。
import type { AtomAfterContext, Skill, GameState } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '救援',
    description: '主公技,锁定技:其他吴势力角色对你使用【桃】的回复值+1',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  registerAfterHook(state, skill.id, ownerId, '回复体力', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; source?: number; amount?: number };
    // 仅当被回复者是孙权本人(被救援)
    if (atom.target !== ownerId) return;
    // 主公技:仅孙权为主公(座次 0)时生效
    if (ownerId !== 0) return;
    // 必须是"其他角色"救援(source 存在且非本人);bonus 回复体力无 source,自动不再触发
    const source = atom.source;
    if (typeof source !== 'number' || source === ownerId) return;
    // 仅当前处于濒死求桃救援场景(桃/酒/急救.respond 设置,runDyingFlow 延迟清除)
    if (ctx.state.localVars['求桃/已救'] !== true) return;
    // 救援者须为吴势力
    const rescuer = ctx.state.players[source];
    if (!rescuer?.alive) return;
    if (rescuer.faction !== '吴') return;

    // 孙权(桃的目标)额外回复1点体力(受 maxHealth 钳制;不携带 source 以避免重入)
    await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
  });

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
