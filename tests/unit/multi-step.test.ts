// tests/unit/multi-step.test.ts — multiStep SkillPhase 骨架测试
//
// 覆盖：
// 1) multiStep 阶段：依次执行多个 step，第二个 step 能读到第一个 step 的 choice
//    （通过 setCtxVar 注入到 ctx.localVars.firstChoice，第二个 prompt 的 options
//     引用此变量构造对象值）。
//
// 骨架版本：只验证 dispatch + 顺序执行基础设施。完整多步交互（choice 串接、
// prompt 之间的状态依赖）由后续 Task 接管。

import { describe, it, expect, beforeEach } from 'vitest';
import { clearAtomRegistry } from '@engine/atom';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import { executePlan } from '@engine/phase';
import type { SkillPhase, GameState, TriggerRule } from '@engine/types';
import { buildSkillContext } from '@engine/context';
import '../../engine/phases/index';

describe('multiStep SkillPhase', () => {
  beforeEach(() => {
    clearAtomRegistry();
    registerAllAtoms();
  });

  it('multiStep: 顺序执行多个 prompt，第二个 prompt 能拿到第一个的 choice', () => {
    const state: GameState = createTestGame();
    const event = { type: '技能发动' as const, player: 'P1', skillId: 'test' };
    const trigger = {
      event: '技能发动',
      source: '角色' as const,
      skillId: 'test',
      player: 'P1',
      priority: 0,
    } satisfies TriggerRule;
    const ctx = buildSkillContext(state, event, trigger);
    const phases: SkillPhase[] = [
      {
        type: 'multiStep',
        steps: [
          {
            type: 'atoms',
            ops: [{ type: '设置上下文变量', key: 'firstChoice', value: 'A' }],
          },
          {
            type: 'prompt',
            text: '现在选 C 或 D（基于 first choice）',
            options: [
              {
                label: 'C',
                value: { first: { $: 'ctx', path: 'localVars.firstChoice' }, second: 'C' },
              },
              { label: 'D', value: 'D' },
            ],
          },
        ],
      },
    ];
    const r = executePlan(state, phases, ctx);
    // 第一个 step 把 firstChoice 注入到 ctx.localVars 后，第二个 step 触发 prompt
    // 暂停，r.state.pending 应该是 skillPrompt（第二个 prompt 等待响应）。
    expect(r.state).toBeDefined();
    expect(r.state.pending).not.toBeNull();
    expect(r.state.pending?.type).toBe('技能选择');
    // 第一个 step 的 setCtxVar 已被执行
    expect(ctx.localVars.firstChoice).toBe('A');
  });
});
