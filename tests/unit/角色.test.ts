// tests/unit/角色.test.ts
import { describe, it, expect } from 'vitest';
import { 所有角色, 魏国角色, 蜀国角色, 吴国角色, 群雄角色 } from '@shared/角色';

describe('角色配置', () => {
  describe('所有角色配置有效性', () => {
    it('应该有角色定义', () => {
      expect(所有角色.length).toBeGreaterThan(0);
    });

    it('每个角色应有name字段', () => {
      for (const 角色 of 所有角色) {
        expect(角色.name).toBeDefined();
        expect(typeof 角色.name).toBe('string');
        expect(角色.name.length).toBeGreaterThan(0);
      }
    });

    it('每个角色应有maxHealth字段', () => {
      for (const 角色 of 所有角色) {
        expect(角色.maxHealth).toBeDefined();
        expect(typeof 角色.maxHealth).toBe('number');
        expect(角色.maxHealth).toBeGreaterThan(0);
      }
    });

    it('每个角色应有gender字段', () => {
      for (const 角色 of 所有角色) {
        expect(角色.gender).toBeDefined();
        expect(['男', '女']).toContain(角色.gender);
      }
    });

    it('每个角色应有faction字段', () => {
      for (const 角色 of 所有角色) {
        expect(角色.faction).toBeDefined();
        expect(['魏', '蜀', '吴', '群']).toContain(角色.faction);
      }
    });

    it('每个角色应有abilities数组', () => {
      for (const 角色 of 所有角色) {
        expect(角色.abilities).toBeDefined();
        expect(Array.isArray(角色.abilities)).toBe(true);
        expect(角色.abilities.length).toBeGreaterThan(0);
      }
    });

    it('每个技能应有name字段', () => {
      for (const 角色 of 所有角色) {
        for (const 技能 of 角色.abilities) {
          expect(技能.name).toBeDefined();
          expect(typeof 技能.name).toBe('string');
          expect(技能.name.length).toBeGreaterThan(0);
        }
      }
    });

    it('每个技能应有description字段', () => {
      for (const 角色 of 所有角色) {
        for (const 技能 of 角色.abilities) {
          expect(技能.description).toBeDefined();
          expect(typeof 技能.description).toBe('string');
          expect(技能.description.length).toBeGreaterThan(0);
        }
      }
    });

    it('每个技能应有trigger字段', () => {
      const 有效触发时机 = [
        'onDamageReceived', 'onDamageDealt', 'onTurnStart', 'onTurnEnd',
        'onCardPlayed', 'onCardDrawn', 'onKill', 'onDeath',
        'onHealReceived', 'onJudge', 'onTargeted', 'onHandEmpty',
        'onEquipChange', 'manual',
      ];
      for (const 角色 of 所有角色) {
        for (const 技能 of 角色.abilities) {
          expect(技能.trigger).toBeDefined();
          expect(有效触发时机).toContain(技能.trigger);
        }
      }
    });

    it('每个技能应有effect字段', () => {
      for (const 角色 of 所有角色) {
        for (const 技能 of 角色.abilities) {
          expect(技能.effect).toBeDefined();
          expect(typeof 技能.effect).toBe('object');
        }
      }
    });

    it('角色名应唯一', () => {
      const 名字列表 = 所有角色.map(c => c.name);
      const 唯一名字 = new Set(名字列表);
      expect(唯一名字.size).toBe(名字列表.length);
    });
  });

  describe('按势力分类', () => {
    it('魏国应有7个角色', () => {
      expect(魏国角色.length).toBe(7);
      for (const 角色 of 魏国角色) {
        expect(角色.faction).toBe('魏');
      }
    });

    it('蜀国应有7个角色', () => {
      expect(蜀国角色.length).toBe(7);
      for (const 角色 of 蜀国角色) {
        expect(角色.faction).toBe('蜀');
      }
    });

    it('吴国应有8个角色', () => {
      expect(吴国角色.length).toBe(8);
      for (const 角色 of 吴国角色) {
        expect(角色.faction).toBe('吴');
      }
    });

    it('群雄应有3个角色', () => {
      expect(群雄角色.length).toBe(3);
      for (const 角色 of 群雄角色) {
        expect(角色.faction).toBe('群');
      }
    });

    it('总共应有25个角色', () => {
      expect(所有角色.length).toBe(25);
    });
  });
});
