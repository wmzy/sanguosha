// engine/phases/multiStep.ts — 顺序多步 SkillPhase 处理器（§6 P0 Task 5 骨架）
//
// 骨架版本：依次执行 steps 中的每个子阶段。如果某一步产生 pending（prompt/respond
// 等需要用户输入），立即返回，把状态交还给调度器。
// 注：当前为 v3 简化的 pending 边界，resumeFrom 跨多步恢复（P1 阶段处理）尚未实现；
// 恢复时 executePlan 仍会从头重放所有 steps。
//
// 后续 Task 接管：把 4 个多步 prompt 技能（观星/火计/遗计/制衡/...）迁移到
// multiStep 形态。
//
// 设计依据：docs/design/v3/0001-v3-redesign.md §4.5

import type { SkillPhase, GameState, SkillContext, EngineResult, ServerEvent } from '../types';
import { registerPhase, executePlan } from '../phase';

type MultiStepPhase = Extract<SkillPhase, { type: 'multiStep' }>;

export function register() {
  registerPhase<MultiStepPhase>({
    type: 'multiStep',
    execute(
      state: GameState,
      phase: MultiStepPhase,
      ctx: SkillContext,
      _plan: SkillPhase[],
      _index: number,
    ): EngineResult {
      let s = state;
      const events: ServerEvent[] = [];

      for (const step of phase.steps) {
        const sub = executePlan(s, [step], ctx);
        s = sub.state;
        events.push(...sub.events);
        // 任何子步骤产生 pending（prompt/respond 等）→ 立即返回，
        // resumeFrom 由 PendingSkillPrompt.execution 保留，恢复时继续。
        if (s.pending !== null) {
          return { state: s, events };
        }
      }

      return { state: s, events };
    },
  });
}
