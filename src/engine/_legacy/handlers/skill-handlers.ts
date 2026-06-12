// @ts-nocheck
import type {
  GameState,
  GameAction,
  EngineResult,
  SkillContext,
  PendingSkillPrompt,
  SkillDef,
  Atom,
} from '../types';
import { executePlan } from '../phase';
import { makeLogEntry } from '../event';

export function resumeSkill(
  state: GameState,
  action: GameAction,
  pending: PendingSkillPrompt,
  _skillRegistry: Map<string, SkillDef>,
): EngineResult {
  if (action.type !== '技能选择') {
    return { state, logEntries: [], error: '技能提示需要 skillChoice 动作' };
  }
  if (action.player !== pending.player) {
    return { state, logEntries: [], error: '只有技能发动者可以做选择' };
  }

  const ctx: SkillContext = {
    ...pending.execution.ctx,
    choice: action.choice,
  };

  // 使用保存的 plan 从暂停点继续执行，避免重新执行 handler（state 可能已变）
  return executePlan(
    { ...state, pending: null },
    pending.execution.plan,
    ctx,
    pending.execution.phaseIndex,
  );
}

export function handleUseSkill(
  state: GameState,
  action: GameAction & { type: '使用技能' },
  skillRegistry: Map<string, SkillDef>,
): EngineResult {
  const skill = skillRegistry.get(action.skillId);
  if (!skill) return { state, logEntries: [], error: `未知技能: ${action.skillId}` };

  const ctx: SkillContext = {
    skillId: action.skillId,
    self: action.player,
    target: action.target,
    localVars: {},
  };

  const phases = skill.handler(ctx, state);
  const planResult = executePlan(state, phases, ctx);
  const activatedLogEntry = makeLogEntry({ type: '技能发动', player: action.player, skillId: action.skillId } as unknown as Atom);

  // 记录技能使用
  const newState: GameState = {
    ...planResult.state,
    turn: {
      ...planResult.state.turn,
      skillsUsed: [...planResult.state.turn.skillsUsed, action.skillId],
    },
  };

  return { state: newState, logEntries: [...planResult.logEntries, activatedLogEntry] };
}
