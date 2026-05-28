// tests/unit/characters.test.ts
import { describe, it, expect } from 'vitest';
import { allCharacters, weiCharacters, shuCharacters, wuCharacters, qunCharacters } from '@shared/characters';

describe('角色配置', () => {
  describe('所有角色配置有效性', () => {
    it('应该有角色定义', () => {
      expect(allCharacters.length).toBeGreaterThan(0);
    });

    it('每个角色应有name字段', () => {
      for (const character of allCharacters) {
        expect(character.name).toBeDefined();
        expect(typeof character.name).toBe('string');
        expect(character.name.length).toBeGreaterThan(0);
      }
    });

    it('每个角色应有maxHealth字段', () => {
      for (const character of allCharacters) {
        expect(character.maxHealth).toBeDefined();
        expect(typeof character.maxHealth).toBe('number');
        expect(character.maxHealth).toBeGreaterThan(0);
      }
    });

    it('每个角色应有gender字段', () => {
      for (const character of allCharacters) {
        expect(character.gender).toBeDefined();
        expect(['男', '女']).toContain(character.gender);
      }
    });

    it('每个角色应有faction字段', () => {
      for (const character of allCharacters) {
        expect(character.faction).toBeDefined();
        expect(['魏', '蜀', '吴', '群']).toContain(character.faction);
      }
    });

    it('每个角色应有abilities数组', () => {
      for (const character of allCharacters) {
        expect(character.abilities).toBeDefined();
        expect(Array.isArray(character.abilities)).toBe(true);
        expect(character.abilities.length).toBeGreaterThan(0);
      }
    });

    it('每个技能应有name字段', () => {
      for (const character of allCharacters) {
        for (const ability of character.abilities) {
          expect(ability.name).toBeDefined();
          expect(typeof ability.name).toBe('string');
          expect(ability.name.length).toBeGreaterThan(0);
        }
      }
    });

    it('每个技能应有description字段', () => {
      for (const character of allCharacters) {
        for (const ability of character.abilities) {
          expect(ability.description).toBeDefined();
          expect(typeof ability.description).toBe('string');
          expect(ability.description.length).toBeGreaterThan(0);
        }
      }
    });

    it('每个技能应有trigger字段', () => {
      const validTriggers = [
        'onDamageReceived', 'onDamageDealt', 'onTurnStart', 'onTurnEnd',
        'onCardPlayed', 'onCardDrawn', 'onKill', 'onDeath',
        'onHealReceived', 'onJudge', 'onTargeted', 'onHandEmpty',
        'onEquipChange', 'manual',
      ];
      for (const character of allCharacters) {
        for (const ability of character.abilities) {
          expect(ability.trigger).toBeDefined();
          expect(validTriggers).toContain(ability.trigger);
        }
      }
    });

    it('每个技能应有effect字段', () => {
      for (const character of allCharacters) {
        for (const ability of character.abilities) {
          expect(ability.effect).toBeDefined();
          expect(typeof ability.effect).toBe('object');
        }
      }
    });

    it('角色名应唯一', () => {
      const nameList = allCharacters.map(c => c.name);
      const uniqueNames = new Set(nameList);
      expect(uniqueNames.size).toBe(nameList.length);
    });
  });

  describe('按势力分类', () => {
    it('魏国应有7个角色', () => {
      expect(weiCharacters.length).toBe(7);
      for (const character of weiCharacters) {
        expect(character.faction).toBe('魏');
      }
    });

    it('蜀国应有7个角色', () => {
      expect(shuCharacters.length).toBe(7);
      for (const character of shuCharacters) {
        expect(character.faction).toBe('蜀');
      }
    });

    it('吴国应有8个角色', () => {
      expect(wuCharacters.length).toBe(8);
      for (const character of wuCharacters) {
        expect(character.faction).toBe('吴');
      }
    });

    it('群雄应有3个角色', () => {
      expect(qunCharacters.length).toBe(3);
      for (const character of qunCharacters) {
        expect(character.faction).toBe('群');
      }
    });

    it('总共应有25个角色', () => {
      expect(allCharacters.length).toBe(25);
    });
  });
});
