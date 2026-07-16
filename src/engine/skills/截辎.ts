// 截辎(界徐晃·锁定技):一名其他角色跳过摸牌阶段后,你摸一张牌。
//
// 触发检测(关键设计):
//   "跳过摸牌阶段"在引擎中由 skipPhase 实现(兵粮寸断/神速/巧变等):
//     skipPhase 在 阶段开始(摸牌) 的 before-hook 中 applyAtom(阶段结束,摸牌) + cancel。
//   cancel 导致 阶段开始(摸牌) 的 apply/after-hook 不执行;而 阶段结束(摸牌) 仍执行。
//   正常摸牌阶段:阶段开始(摸牌) apply 成功 → after-hook 执行 → 摸牌2张 → 阶段结束(摸牌)。
//
//   故检测策略:
//   1) 阶段开始(摸牌) after-hook:标记 normalDrawPhase=player(仅正常开始时执行;被跳过时不执行)
//   2) 阶段结束(摸牌) after-hook:若 normalDrawPhase !== player → 该玩家跳过了摸牌阶段
//      → 若是其他角色且自己存活 → 摸一张牌
//
//   此方法捕获所有跳过摸牌阶段的情况(兵粮寸断/神速/界神速/巧变),
//   且与 skipPhase 的具体实现(标签型/直接型)无关。
//
// 锁定技:无条件触发,无需询问玩家。
import type { AtomAfterContext, FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

/** 标记:最近一个正常开始的摸牌阶段所属玩家 */
const MARKER_KEY = '截辎/normalDrawPhase';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '截辎',
    description: '锁定技:一名其他角色跳过摸牌阶段后,你摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 阶段开始(摸牌) after-hook:仅正常开始时执行(被 skipPhase cancel 时不执行)
  // → 标记该玩家的摸牌阶段是正常开始的
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; phase: string; player: number };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '摸牌') return;
    ctx.state.localVars[MARKER_KEY] = atom.player;
  });

  // 阶段结束(摸牌) after-hook:正常和跳过都执行
  // → 若无正常开始标记 → 该玩家跳过了摸牌阶段
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; phase: string; player: number };
    if (atom.type !== '阶段结束') return;
    if (atom.phase !== '摸牌') return;

    const phasePlayer = atom.player;
    const startedNormally = ctx.state.localVars[MARKER_KEY] === phasePlayer;
    // 清理标记(无论正常/跳过都清理,保持 localVars 干净)
    delete ctx.state.localVars[MARKER_KEY];
    if (startedNormally) return; // 正常摸牌阶段,非跳过

    // 只对其他角色触发("一名其他角色")
    if (phasePlayer === ownerId) return;
    // 自己须存活
    if (!ctx.state.players[ownerId]?.alive) return;

    // 截辎:摸一张牌
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技:无玩家操作,无需定义 action UI
}
