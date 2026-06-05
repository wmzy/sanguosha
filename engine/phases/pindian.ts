// engine/phases/pindian.ts — 拼点 SkillPhase 处理器（§6 P0 Task 4 骨架）
//
// 骨架版本：直接以 SkillPhase 携带的 aCardId/bCardId（或 ctx.localVars 中的
// pindianACard/pindianBCard）作为已揭示的双方手牌，调 compareRank 原子。
// 完整拼点流程（双方分别 prompt 选牌 → 揭示 → 比点）属于后续 Task，本阶段
// 只落基础设施：SkillPhase 变体 + Phase 调度 + 测试。
//
// 设计依据：docs/design/v3/0001-v3-redesign.md §4.5

import type { SkillPhase, GameState, SkillContext, EngineResult, ServerEvent } from '../types';
import { registerPhase, executePlan } from '../phase';
import { resolve } from '../expr';
import { applyAtoms } from '../atom';

type PindianPhase = Extract<SkillPhase, { type: 'pindian' }>;

export function register() {
  registerPhase<PindianPhase>({
    type: 'pindian',
    execute(
      state: GameState,
      phase: PindianPhase,
      ctx: SkillContext,
      _plan: SkillPhase[],
      _index: number,
    ): EngineResult {
      const a = resolve<string>(phase.a, state, ctx);
      const b = resolve<string>(phase.b, state, ctx);
      // 骨架：aCardId/bCardId 优先取 SkillPhase 字面量；缺失则从 ctx.localVars 兜底
      const aCardId =
        phase.aCardId !== undefined
          ? resolve<string>(phase.aCardId, state, ctx)
          : (ctx.localVars.pindianACard as string | undefined);
      const bCardId =
        phase.bCardId !== undefined
          ? resolve<string>(phase.bCardId, state, ctx)
          : (ctx.localVars.pindianBCard as string | undefined);

      if (!aCardId || !bCardId) {
        return {
          state,
          events: [],
          error: 'pindian phase requires aCardId and bCardId (literal or ctx.localVars.pindianACard/BCard)',
        };
      }

      const events: ServerEvent[] = [];
      let s = state;

      // 1) 调 compareRank 原子（已注册到 @engine/atoms）
      const r = applyAtoms(
        s,
        [{ type: 'compareRank', a, b, aCardId, bCardId }],
        { skipPlayerEvents: true },
      );
      s = r.state;
      events.push(...r.events);

      // 2) 注入结果到 ctx.localVars，便于后续 ExprCardProp/condition 引用
      //    winner 从 applyAtoms 派发的 serverEvent payload 中读取
      const winnerFromEvent = r.events[0]?.payload as { winner?: string } | undefined;
      ctx.localVars.pindianWinner = winnerFromEvent?.winner ?? a;
      ctx.localVars.pindianACard = aCardId;
      ctx.localVars.pindianBCard = bCardId;

      // 3) 分支：winner 是 a 走 then，否则走 else
      const branch = ctx.localVars.pindianWinner === a ? phase.then : (phase.else ?? []);
      if (branch.length === 0) return { state: s, events };

      const sub = executePlan(s, branch, ctx);
      s = sub.state;
      events.push(...sub.events);
      return { state: s, events };
    },
  });
}
