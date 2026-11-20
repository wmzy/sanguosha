// 完杀(贾诩·群·锁定技):在你的回合,除你以外,只有处于濒死状态的角色才能使用【桃】。
//
// 实现:before-hook 挂「请求回应」(requestType='桃/求桃')。
//   runDyingFlow(系统规则.ts)按座次依次向每个存活玩家 dispatch 请求回应(桃/求桃)。
//   贾诩回合内,被问询者既非贾诩本人、又非当前濒死者时,该请求被 cancel
//   (applyAtom 在 before-hook cancel 后直接 return,不创建 pending slot——见
//    index.ts applyAtom 的 cancelled 分支位于 def.pending 判定之前)。
//   等价于"该角色不能使用桃"。贾诩本人与濒死角色本人不受限制。
//
//   钩子注册在贾诩座次(ownerId),但 请求回应 atom 的 target 是被问询者(随座次变化),
//   before-hook 对该 atomType 的所有实例触发,handler 内按 atom.target 与"濒死者"判断。
//
//   濒死判据:直接检查被问询者自身(见 peachAskShouldCancel)——runDyingFlow 执行期间
//   濒死者 alive 且 health<=0(扣减体力/失去体力已扣血,系统处理牌 尚未执行);
//   嵌套濒死时多名濒死者并存,不可用 findIndex(只返回第一个,其余会被误 cancel)。
//
//   适用范围:桃/酒.respond/急救.respond 等"用桃救援"均通过 桃/求桃 pending 触发,
//   被 cancel 的请求直接跳过该角色,这些 respond action 无从对该角色发起 → 完杀生效。
import type { HookResult, Skill, GameState, AtomOfName, SkillModule } from '../types';
import { registerBeforeHook } from '../core/skill';

/**
 * 完杀桃限制谓词(标版/界完杀共用):求桃问询 && 贾诩回合 && 被问询者非贾诩本人
 * && 被问询者不濒死 → 应 cancel。濒死判据直接查被问询者自身(asked.alive &&
 * health<=0),不用 findIndex——嵌套濒死时多名濒死者并存,findIndex 只返回第一个。
 */
export function peachAskShouldCancel(
  state: GameState,
  ownerId: number,
  atom: AtomOfName<'请求回应'>,
): boolean {
  if (atom.requestType !== '桃/求桃') return false; // 仅干预濒死求桃
  if (state.currentPlayerIndex !== ownerId) return false; // 仅在贾诩回合内生效
  const asked = atom.target;
  if (typeof asked !== 'number') return false;
  if (asked === ownerId) return false; // 贾诩本人可使用桃
  // 濒死者本人可使用桃
  const askedPlayer = state.players[asked];
  return !(askedPlayer?.alive && askedPlayer.health <= 0);
}

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
      // 其余角色:不能使用桃 → 跳过对该角色的问询
      if (peachAskShouldCancel(ctx.state, ownerId, ctx.atom)) return { kind: 'cancel' };
    },
  );
  return () => {};
}

export default { createSkill, onInit } satisfies SkillModule;
