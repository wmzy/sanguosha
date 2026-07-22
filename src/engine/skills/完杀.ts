// 完杀(贾诩·群·锁定技):在你的回合,除你以外,只有处于濒死状态的角色才能使用【桃】。
//
// 实现:before-hook 挂「请求回应」(requestType='桃/求桃')。
//   runDyingFlow(系统规则.ts)按座次依次向每个存活玩家 dispatch 请求回应(桃/求桃)。
//   贾诩回合内,被问询者既非贾诩本人、又非当前濒死者时,该请求被 cancel
//   (applyAtom 在 before-hook cancel 后直接 return,不创建 pending slot——见
//    create-engine.ts applyAtom 的 cancelled 分支位于 def.pending 判定之前)。
//   等价于"该角色不能使用桃"。贾诩本人与濒死角色本人不受限制。
//
//   钩子注册在贾诩座次(ownerId),但 请求回应 atom 的 target 是被问询者(随座次变化),
//   before-hook 对该 atomType 的所有实例触发,handler 内按 atom.target 与"濒死者"判断。
//
//   濒死者定位:runDyingFlow 执行期间,濒死者 alive=true 且 health<=0(造成伤害/失去体力
//   已扣血,击杀 atom 尚未执行)。扫描存活且 health<=0 的玩家即当前濒死者。
//   (runDyingFlow 同步串行,同时只有一个濒死者。)
//
//   适用范围:桃/酒.respond/急救.respond 等"用桃救援"均通过 桃/求桃 pending 触发,
//   被 cancel 的请求直接跳过该角色,这些 respond action 无从对该角色发起 → 完杀生效。
import type { HookResult, Skill, GameState } from '../types';
import { registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '完杀',
    description: '锁定技:在你的回合,除你以外,只有处于濒死状态的角色才能使用【桃】',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '请求回应',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.requestType !== '桃/求桃') return; // 仅干预濒死求桃
      // 仅在贾诩回合内生效
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const asked = atom.target;
      if (typeof asked !== 'number') return;
      // 贾诩本人可使用桃
      if (asked === ownerId) return;
      // 濒死者本人可对自己使用桃
      const dying = ctx.state.players.findIndex((p) => p.alive && p.health <= 0);
      if (asked === dying) return;
      // 其余角色:不能使用桃 → 跳过对该角色的问询
      return { kind: 'cancel' };
    },
  );
  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
