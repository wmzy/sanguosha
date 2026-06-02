import { describe, it, expect } from 'vitest';
import { executePlan } from '@engine/phase';
import { registerCharacterTriggers, registerSkill, getSkillRegistry } from '@engine/skill';
import type { SkillContext, GameState, SkillPhase, PendingAction } from '@engine/types';
import {
  getCharacterMap,
  createTestGame,
  setHealth,
  injectCard,
  findCardInHand,
} from './engine-helpers';

import '../engine/atoms/index';
import '../engine/phases/index';

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

describe('ATOM_GAME_EVENTS 自动事件发射', () => {
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
              type: 'damage',
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
              type: 'damage',
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
            { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
            { type: 'damage', target: 'P2', amount: 1, source: 'P1' },
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
            { type: 'heal', target: 'P1', amount: 1 },
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
            { type: 'heal', target: 'P1', amount: 1, source: 'P2' },
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
        type: 'skillPrompt',
        skillId: 'test-pending-skill',
        player: 'P1',
        execution: { phaseIndex: 0, ctx: makeCtx({ self: 'P1' }), plan: [] },
        prompt: { text: '选择', options: [{ label: '确定', value: true }] },
        timeout: 10000,
        deadline: Date.now() + 10000,
        onTimeout: { type: 'endTurn', player: 'P1' },
      };

      const skillId = '__test_pending_on_damage__';
      if (!getSkillRegistry().has(skillId)) {
        registerSkill({
          id: skillId,
          name: '测试-伤害暂停',
          description: '受到伤害后创建 pending',
          trigger: { event: 'damageReceived', source: 'character' },
          handler(_ctx, _state) {
            return [
              {
                type: 'atoms',
                ops: [{ type: 'pushPending' as const, action: pendingAction }],
              },
            ];
          },
        });
      }

      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state.triggers = [
        ...state.triggers,
        { event: 'damageReceived', source: 'character', skillId, player: 'P1', priority: 5 },
      ];
      state = setHealth(state, 'P1', 2);

      const ctx = makeCtx({ self: 'P2' });
      const plan: SkillPhase[] = [
        {
          type: 'atoms',
          ops: [
            { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
            { type: 'draw', player: 'P2', count: 1 },
          ],
        },
      ];

      const beforeP2Hand = state.players.P2.hand.length;
      const result = executePlan(state, plan, ctx);
      expect(result.error).toBeUndefined();
      expect(result.state.players.P1.health).toBe(1);
      expect(result.state.pending).not.toBeNull();
      expect(result.state.pending?.type).toBe('skillPrompt');
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
            { type: 'draw', player: 'P1', count: 2 },
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
