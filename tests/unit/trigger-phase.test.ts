// tests/unit/trigger-phase.test.ts — engine/skill.ts emitEvent phase 字段覆盖
//
// 修 §4.4：trigger.phase 字段应对所有事件类型生效，而非仅 phaseBegin。
// - phaseBegin / phaseEnd: 读 event.phase
// - 其他事件（cardPlayed 等）：读 state.phase
// 此前若 trigger.event=cardPlayed 且 trigger.phase='出牌'，phase 字段被静默忽略。

import { describe, it, expect, beforeEach } from 'vitest';
import { clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import {
  registerSkill,
  clearSkillRegistry,
  emitEvent,
} from '@engine/skill';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setPlayPhase } from '../engine-helpers';
import type { SkillDef, GameState, TurnPhase, TriggerRule } from '@engine/types';

/** 构造一个处于指定阶段的 GameState，并把 phaseProbe 触发器塞到 state.triggers 里。 */
function stateWithProbe(
  currentPhase: TurnPhase,
  triggerEvent: string,
  triggerPhase?: TurnPhase,
): GameState {
  const base = setPlayPhase(createTestGame({ playerCount: 2 }));
  const probe: TriggerRule = {
    event: triggerEvent,
    source: 'character',
    skillId: '_phaseProbe',
    player: 'P1',
    priority: 5,
    ...(triggerPhase ? { phase: triggerPhase } : {}),
  };
  return { ...base, phase: currentPhase, triggers: [...base.triggers, probe] };
}

describe('§4.4 触发器 phase 字段对所有事件类型生效', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    clearSkillRegistry();
    registerAllAtoms();
  });

  it('trigger.phase=出牌 + event=phaseBegin(出牌) → 触发', () => {
    const def: SkillDef = {
      id: '_phaseProbe',
      name: '相位探针',
      description: 'test',
      trigger: { event: 'phaseBegin', source: 'character', phase: '出牌' },
      handler(_ctx, _state) {
        return [];
      },
    };
    registerSkill(def);
    const state = stateWithProbe('出牌', 'phaseBegin', '出牌');
    const result = emitEvent(state, {
      type: 'phaseBegin',
      phase: '出牌',
      player: 'P1',
    });
    expect(result.state).toBeDefined();
  });

  it('trigger.phase=出牌 + event=phaseBegin(摸牌) → 跳过（phase 不匹配）', () => {
    const def: SkillDef = {
      id: '_phaseProbe',
      name: '相位探针',
      description: 'test',
      trigger: { event: 'phaseBegin', source: 'character', phase: '出牌' },
      handler(_ctx, _state) {
        return [
          {
            type: 'atoms',
            ops: [{ type: 'setVar', player: 'P1', key: '_phaseProbe/fired', value: true }],
          },
        ];
      },
    };
    registerSkill(def);
    const state = stateWithProbe('摸牌', 'phaseBegin', '出牌');
    const result = emitEvent(state, {
      type: 'phaseBegin',
      phase: '摸牌',
      player: 'P1',
    });
    expect(result.state.players['P1'].vars['_phaseProbe/fired']).toBeUndefined();
  });

  it('trigger.phase=出牌 + event=phaseEnd(出牌) → 触发（修 §4.4）', () => {
    // 之前 phaseEnd 完全不查 trigger.phase；之后 phaseEnd 也要查。
    const def: SkillDef = {
      id: '_phaseProbe',
      name: '相位探针',
      description: 'test',
      trigger: { event: 'phaseEnd', source: 'character', phase: '出牌' },
      handler(_ctx, _state) {
        return [
          {
            type: 'atoms',
            ops: [{ type: 'setVar', player: 'P1', key: '_phaseProbe/fired', value: true }],
          },
        ];
      },
    };
    registerSkill(def);
    const state = stateWithProbe('出牌', 'phaseEnd', '出牌');
    const result = emitEvent(state, {
      type: 'phaseEnd',
      phase: '出牌',
      player: 'P1',
    });
    expect(result.state.players['P1'].vars['_phaseProbe/fired']).toBe(true);
  });

  it('trigger.phase=出牌 + event=phaseEnd(摸牌) → 跳过（修 §4.4）', () => {
    const def: SkillDef = {
      id: '_phaseProbe',
      name: '相位探针',
      description: 'test',
      trigger: { event: 'phaseEnd', source: 'character', phase: '出牌' },
      handler(_ctx, _state) {
        return [
          {
            type: 'atoms',
            ops: [{ type: 'setVar', player: 'P1', key: '_phaseProbe/fired', value: true }],
          },
        ];
      },
    };
    registerSkill(def);
    const state = stateWithProbe('摸牌', 'phaseEnd', '出牌');
    const result = emitEvent(state, {
      type: 'phaseEnd',
      phase: '摸牌',
      player: 'P1',
    });
    expect(result.state.players['P1'].vars['_phaseProbe/fired']).toBeUndefined();
  });

  it('trigger.phase=出牌 + event=cardPlayed 且 state.phase=出牌 → 触发（修 §4.4）', () => {
    // 关键回归：之前 cardPlayed 完全忽略 phase，handler 总被调。
    // 修后：state.phase === '出牌' → 触发。
    const def: SkillDef = {
      id: '_phaseProbe',
      name: '相位探针',
      description: 'test',
      trigger: { event: 'cardPlayed', source: 'character', phase: '出牌' },
      handler(_ctx, _state) {
        return [
          {
            type: 'atoms',
            ops: [{ type: 'setVar', player: 'P1', key: '_phaseProbe/fired', value: true }],
          },
        ];
      },
    };
    registerSkill(def);
    const state = stateWithProbe('出牌', 'cardPlayed', '出牌');
    const result = emitEvent(state, {
      type: 'cardPlayed',
      player: 'P1',
      cardId: 'fake-card-1',
    });
    expect(result.state.players['P1'].vars['_phaseProbe/fired']).toBe(true);
  });

  it('trigger.phase=出牌 + event=cardPlayed 且 state.phase=摸牌 → 跳过（修 §4.4）', () => {
    // 关键回归：之前 cardPlayed 完全忽略 phase，handler 总被调。
    // 修后：state.phase !== '出牌' → 跳过。
    const def: SkillDef = {
      id: '_phaseProbe',
      name: '相位探针',
      description: 'test',
      trigger: { event: 'cardPlayed', source: 'character', phase: '出牌' },
      handler(_ctx, _state) {
        return [
          {
            type: 'atoms',
            ops: [{ type: 'setVar', player: 'P1', key: '_phaseProbe/fired', value: true }],
          },
        ];
      },
    };
    registerSkill(def);
    const state = stateWithProbe('摸牌', 'cardPlayed', '出牌');
    const result = emitEvent(state, {
      type: 'cardPlayed',
      player: 'P1',
      cardId: 'fake-card-1',
    });
    expect(result.state.players['P1'].vars['_phaseProbe/fired']).toBeUndefined();
  });

  it('trigger 无 phase 字段时对任何事件都触发（不破坏老路径）', () => {
    // 回归保护：不写 phase 字段时，emitEvent 行为应与之前一致。
    const def: SkillDef = {
      id: '_phaseProbe',
      name: '相位探针',
      description: 'test',
      trigger: { event: 'cardPlayed', source: 'character' },
      handler(_ctx, _state) {
        return [
          {
            type: 'atoms',
            ops: [{ type: 'setVar', player: 'P1', key: '_phaseProbe/fired', value: true }],
          },
        ];
      },
    };
    registerSkill(def);
    const state = stateWithProbe('摸牌', 'cardPlayed');
    const result = emitEvent(state, {
      type: 'cardPlayed',
      player: 'P1',
      cardId: 'fake-card-1',
    });
    expect(result.state.players['P1'].vars['_phaseProbe/fired']).toBe(true);
  });
});
