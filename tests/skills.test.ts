import { describe, it, expect } from 'vitest';
import { registerCharacterTriggers, emitEvent } from '@engine/skill';
import { safeEngine as engine } from './invariants';
import { getCharacterMap, createTestGame, setPlayPhase } from './engine-helpers';

describe('V2 Engine - 技能注册与触发', () => {
  const charMap = getCharacterMap();

  describe('角色触发器注册', () => {
    it('曹操 奸雄 技能注册', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });

      const trigger = state.triggers.find(
        (t) => t.skillId === '奸雄' && t.player === 'P1',
      );
      expect(trigger).toBeDefined();
      expect(trigger!.event).toBe('damageReceived');
      expect(trigger!.source).toBe('character');
    });

    it('刘备 仁德 技能注册', () => {
      let state = createTestGame({ characters: ['刘备', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });

      const trigger = state.triggers.find(
        (t) => t.skillId === '仁德' && t.player === 'P1',
      );
      expect(trigger).toBeDefined();
    });

    it('司马懿 反馈 技能注册', () => {
      let state = createTestGame({ characters: ['司马懿', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });

      const trigger = state.triggers.find(
        (t) => t.skillId === '反馈' && t.player === 'P1',
      );
      expect(trigger).toBeDefined();
      expect(trigger!.event).toBe('damageReceived');
    });

    it('孙权 制衡 技能注册', () => {
      let state = createTestGame({ characters: ['孙权', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });

      const trigger = state.triggers.find(
        (t) => t.skillId === '制衡' && t.player === 'P1',
      );
      expect(trigger).toBeDefined();
    });

    it('诸葛亮 观星 技能注册（如果存在）', () => {
      let state = createTestGame({ characters: ['诸葛亮', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });

      const triggers = state.triggers.filter(
        (t) => t.player === 'P1',
      );
      // 诸葛亮至少有技能触发器
      expect(triggers.length).toBeGreaterThan(0);
    });

    it('多个角色的触发器共存', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      state = registerCharacterTriggers(state, 'P2', { characterMap: charMap });

      const p1Triggers = state.triggers.filter((t) => t.player === 'P1');
      const p2Triggers = state.triggers.filter((t) => t.player === 'P2');

      expect(p1Triggers.length).toBeGreaterThan(0);
      expect(p2Triggers.length).toBeGreaterThan(0);
    });
  });

  describe('事件触发技能', () => {
    it('damageReceived 事件触发 奸雄', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });

      const event = {
        type: 'damageReceived' as const,
        player: 'P2',
        target: 'P1',
        source: 'P2',
        amount: 1,
      };

      const result = emitEvent(state, event);
      // 奸雄处理器会尝试 gainCard，如果没有 sourceCard 会返回空
      // 但事件匹配和触发器执行应该成功
      expect(result).toBeDefined();
      expect(result.state).toBeDefined();
    });
  });

  describe('技能使用限制', () => {
    it('useSkill 在非出牌阶段报错', () => {
      const state = createTestGame({ characters: ['曹操', '刘备'] });
      const result = engine(state, {
        type: 'useSkill',
        player: 'P1',
        skillId: '奸雄',
      });
      expect(result.error).toBeTruthy();
    });

    it('useSkill 对未知技能报错', () => {
      const state = setPlayPhase(createTestGame());
      const result = engine(state, {
        type: 'useSkill',
        player: 'P1',
        skillId: '不存在的技能',
      });
      expect(result.error).toBeTruthy();
    });
  });
});
