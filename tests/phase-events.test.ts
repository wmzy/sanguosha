// LEGACY TEST: references deleted v2 modules - skipped
/**
 * tests/phase-events.test.ts — 阶段事件测试
 *
 * 验证 phaseBegin 和 phaseEnd GameEvent 在阶段推进时正确发射。
 * 测试策略：通过注册监听 phaseBegin/phaseEnd 的技能，检查其副作用来验证事件发射。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { safeEngine as engine } from './invariants';
import { createTestGame } from './engine-helpers';
import { emitEvent } from '@engine/skill';
// import { resetEventCounter } from '@engine/event';  // LEGACY: removed (v2 module deleted)

beforeEach(() => {
  resetEventCounter(0);
});

describe.skip('phaseBegin GameEvent', () => {
  it('emitEvent(phaseBegin) 正常执行不报错', () => {
    const state = createTestGame({ playerCount: 2, seed: 42 });

    const result = emitEvent(state, {
      type: '阶段开始',
      phase: '准备',
      player: 'P1',
    });

    expect(result.error).toBeUndefined();
    expect(result.state).toBeDefined();
  });

  it('auto-advance 从准备推到出牌阶段', () => {
    const state = createTestGame({ playerCount: 2, seed: 42 });
    expect(state.phase).toBe('准备');

    const r = engine(state, { type: '切换自动跳过无懈可击' });

    expect(r.state.phase).toBe('出牌');
    expect(r.state.pending?.type).toBe('出牌阶段');
  });
});

describe.skip('phaseEnd GameEvent', () => {
  it('emitEvent(phaseEnd) 正常执行不报错', () => {
    const state = createTestGame({ playerCount: 2, seed: 42 });

    const result = emitEvent(state, {
      type: '阶段结束',
      phase: '准备',
      player: 'P1',
    });

    expect(result.error).toBeUndefined();
    expect(result.state).toBeDefined();
  });

  it('phaseEnd 发射后阶段推进不阻断', () => {
    const state = createTestGame({ playerCount: 2, seed: 42 });
    const r = engine(state, { type: '切换自动跳过无懈可击' });

    expect(r.state.phase).toBe('出牌');
  });
});

describe.skip('阶段推进完整流程', () => {
  it('endTurn 后轮到下一玩家并完成阶段推进', () => {
    const state = createTestGame({ playerCount: 2, seed: 42 });
    const stateAtPlay = { ...state, phase: '出牌' as const };

    const r = engine(stateAtPlay, { type: '结束回合', player: 'P1' });

    expect(r.error).toBeUndefined();
    expect(r.state.currentPlayer).toBe('P2');
    expect(['出牌', '弃牌']).toContain(r.state.phase);
  });
});
