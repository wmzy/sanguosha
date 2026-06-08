import { describe, it, expect, beforeEach } from 'vitest';
import { executePlan } from '@engine/phase';
import { registerCharacterTriggers, registerSkill, getSkillRegistry } from '@engine/skill';
// [P6-1] 触发 registerAllEngineSkills()，让 v3 registerAtomHook 技能注册到默认 HookRegistry
// （executePlan 走 phases/atoms.ts applyAtoms 触发 v3 钩子）
// 注意：vitest 各 test 串行运行时，前序测试可能 clearAtomHooks() 清空钩子。
// beforeEach 重新注册以确保钩子到位。
import { registerAllSkills as registerAllEngineSkills, resetAndRegisterAllSkills } from '@engine/skills';
import { clearAtomHooks } from '@engine/skill-hook';
import type { SkillContext, GameState, SkillPhase, PendingAction } from '@engine/types';
import {
  getCharacterMap,
  createTestGame,
  setHealth,
  injectCard,
  findCardInHand,
} from './engine-helpers';

import '../src/engine/atoms/index';
import '../src/engine/phases/index';

beforeEach(() => {
  // 之前测试可能 clearAtomHooks()，重新注册 v3 钩子
  clearAtomHooks();
  registerAllEngineSkills(undefined, { force: true });
});

const charMap = getCharacterMap();

function makeCtx(overrides?: Partial<SkillContext>): SkillContext {
  return {
    skillId: 'test-skill',
    self: 'P1',
    localVars: {},
    ...overrides,
  };
}

function withTriggers(state: GameState, ...players: string[]): GameState {
  let s = state;
  for (const p of players) {
    s = registerCharacterTriggers(s, p, { characterMap: charMap });
  }
  return s;
}

describe.skip('ATOM_GAME_EVENTS 自动事件发射', () => {
  describe('damage atom', () => {
    it('damage atom 在 atoms phase 中自动发射 damageReceived 触发奸雄', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = withTriggers(state, 'P1');
      state = injectCard(state, 'P2', '杀');
      const killId = findCardInHand(state, 'P2', '杀')!;
      state = setHealth(state, 'P1', 2);

      const beforeHand = state.players.P1.hand.length;
      const ctx = makeCtx({ self: 'P2' });
      const plan: SkillPhase[] = [
        {
          type: 'atoms',
          ops: [
            {
              type: '造成伤害',
              target: 'P1',
              amount: 1,
              source: 'P2',
              cardId: killId,
            },
          ],
        },
      ];

      const result = executePlan(state, plan, ctx);
      expect(result.error).toBeUndefined();
      expect(result.state.players.P1.health).toBe(1);
      expect(result.state.players.P1.hand.length).toBe(beforeHand + 1);
    });

    it('damage atom 无 cardId 时 damageReceived 仍被发射', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = withTriggers(state, 'P1');
      state = setHealth(state, 'P1', 2);

      const beforeHand = state.players.P1.hand.length;
      const ctx = makeCtx({ self: 'P2' });
      const plan: SkillPhase[] = [
        {
          type: 'atoms',
          ops: [
            {
              type: '造成伤害',
              target: 'P1',
              amount: 1,
              source: 'P2',
            },
          ],
        },
      ];

      const result = executePlan(state, plan, ctx);
      expect(result.error).toBeUndefined();
      expect(result.state.players.P1.health).toBe(1);
      expect(result.state.players.P1.hand.length).toBe(beforeHand);
    });

    it('damage atom 多次伤害顺序发射事件', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = withTriggers(state, 'P1');
      state = setHealth(state, 'P1', 4);
      state = setHealth(state, 'P2', 4);

      const ctx = makeCtx({ self: 'P2' });
      const plan: SkillPhase[] = [
        {
          type: 'atoms',
          ops: [
            { type: '造成伤害', target: 'P1', amount: 1, source: 'P2' },
            { type: '造成伤害', target: 'P2', amount: 1, source: 'P1' },
          ],
        },
      ];

      const result = executePlan(state, plan, ctx);
      expect(result.error).toBeUndefined();
      expect(result.state.players.P1.health).toBe(3);
      expect(result.state.players.P2.health).toBe(3);
    });
  });

  describe('heal atom', () => {
    it('heal atom 在 atoms phase 中自动发射 heal 事件', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = setHealth(state, 'P1', 2);

      const ctx = makeCtx({ self: 'P1' });
      const plan: SkillPhase[] = [
        {
          type: 'atoms',
          ops: [
            { type: '回复体力', target: 'P1', amount: 1 },
          ],
        },
      ];

      const result = executePlan(state, plan, ctx);
      expect(result.error).toBeUndefined();
      expect(result.state.players.P1.health).toBe(3);
    });

    it('heal atom 带 source 字段', () => {
      let state = createTestGame();
      state = setHealth(state, 'P1', 2);

      const ctx = makeCtx({ self: 'P2' });
      const plan: SkillPhase[] = [
        {
          type: 'atoms',
          ops: [
            { type: '回复体力', target: 'P1', amount: 1, source: 'P2' },
          ],
        },
      ];

      const result = executePlan(state, plan, ctx);
      expect(result.error).toBeUndefined();
      expect(result.state.players.P1.health).toBe(3);
    });
  });

  describe('技能链暂停', () => {
    it('damage 触发技能链后创建 pending 时执行暂停', () => {
      const pendingAction: PendingAction = {
        id: 'test-pending',
        type: '技能选择',
        skillId: 'test-pending-skill',
        player: 'P1',
        execution: { phaseIndex: 0, ctx: makeCtx({ self: 'P1' }), plan: [] },
        prompt: { text: '选择', options: [{ label: '确定', value: true }] },
        timeout: 10000,
        deadline: Date.now() + 10000,
        onTimeout: { type: '结束回合', player: 'P1' },
      };

      const skillId = '__test_pending_on_damage__';
      if (!getSkillRegistry().has(skillId)) {
        registerSkill({
          id: skillId,
          name: '测试-伤害暂停',
          description: '受到伤害后创建 pending',
          trigger: { event: '受到伤害', source: '角色' },
          handler(_ctx, _state) {
            return [
              {
                type: 'atoms',
                ops: [{ type: '推入待定' as const, action: pendingAction }],
              },
            ];
          },
        });
      }

      let state = createTestGame({ characters: ['曹操', '刘备'] });
      // [P5-T3] 阶段 D：emitEvent 不再读 state.triggers，改为从 PlayerState.skills 动态构建。
      // 将测试技能 ID 注入 P1 的 skills 列表，让 emitEvent 能匹配到。
      const p1 = state.players.P1;
      state = {
        ...state,
        players: { ...state.players, P1: { ...p1, skills: [...p1.skills, skillId] } },
      };
      state = setHealth(state, 'P1', 2);

      const ctx = makeCtx({ self: 'P2' });
      const plan: SkillPhase[] = [
        {
          type: 'atoms',
          ops: [
            { type: '造成伤害', target: 'P1', amount: 1, source: 'P2' },
            { type: '摸牌', player: 'P2', count: 1 },
          ],
        },
      ];

      const beforeP2Hand = state.players.P2.hand.length;
      const result = executePlan(state, plan, ctx);
      expect(result.error).toBeUndefined();
      expect(result.state.players.P1.health).toBe(1);
      expect(result.state.pending).not.toBeNull();
      expect(result.state.pending?.type).toBe('技能选择');
      expect(result.state.players.P2.hand.length).toBe(beforeP2Hand);
    });
  });

  describe('非映射 atom', () => {
    it('draw atom 不发射 GameEvent', () => {
      let state = createTestGame();
      state = withTriggers(state, 'P1');
      const beforeHand = state.players.P1.hand.length;

      const ctx = makeCtx({ self: 'P1' });
      const plan: SkillPhase[] = [
        {
          type: 'atoms',
          ops: [
            { type: '摸牌', player: 'P1', count: 2 },
          ],
        },
      ];

      const result = executePlan(state, plan, ctx);
      expect(result.error).toBeUndefined();
      expect(result.state.players.P1.hand.length).toBe(beforeHand + 2);
      expect(result.state.pending).toBeNull();
    });
  });
});
