// tests/unit/cards-ext.test.ts
import { describe, it, expect } from 'vitest';
import {
  weapons, armors, horses, allTricks,
  normalTricks, delayedTricks, reactiveTricks,
  createDeck,
  isWeapon, isArmor, isHorse, isEquipment, isTrick, isDelayedTrick,
  isBlackSuit, isRedSuit,
} from '@shared/cards';

describe('装备牌', () => {
  describe('武器牌', () => {
    it('应该有8种武器', () => {
      expect(weapons.length).toBe(8);
    });

    it('每张武器应有name字段', () => {
      for (const weapon of weapons) {
        expect(weapon.name).toBeDefined();
        expect(typeof weapon.name).toBe('string');
        expect(weapon.name.length).toBeGreaterThan(0);
      }
    });

    it('每张武器应有类型为装备牌', () => {
      for (const weapon of weapons) {
        expect(weapon.type).toBe('装备牌');
      }
    });

    it('每张武器应有子类型为武器', () => {
      for (const weapon of weapons) {
        expect(weapon.subtype).toBe('武器');
      }
    });

    it('每张武器应有距离字段', () => {
      for (const weapon of weapons) {
        expect(weapon.range).toBeDefined();
        expect(typeof weapon.range).toBe('number');
        expect(weapon.range!).toBeGreaterThan(0);
      }
    });

    it('每张武器应有花色和点数', () => {
      for (const weapon of weapons) {
        expect(['♠', '♥', '♣', '♦']).toContain(weapon.suit);
        expect(weapon.rank).toBeDefined();
      }
    });

    it('每张武器应有描述', () => {
      for (const weapon of weapons) {
        expect(weapon.description).toBeDefined();
        expect(typeof weapon.description).toBe('string');
        expect(weapon.description.length).toBeGreaterThan(0);
      }
    });

    it('武器名应唯一', () => {
      const nameList = weapons.map(w => w.name);
      const uniqueNames = new Set(nameList);
      expect(uniqueNames.size).toBe(nameList.length);
    });
  });

  describe('防具牌', () => {
    it('应该有2种防具', () => {
      expect(armors.length).toBe(2);
    });

    it('每张防具应有类型为装备牌', () => {
      for (const armor of armors) {
        expect(armor.type).toBe('装备牌');
      }
    });

    it('每张防具应有子类型为防具', () => {
      for (const armor of armors) {
        expect(armor.subtype).toBe('防具');
      }
    });

    it('每张防具应有描述', () => {
      for (const armor of armors) {
        expect(armor.description).toBeDefined();
        expect(armor.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('马牌', () => {
    it('应该有6种马', () => {
      expect(horses.length).toBe(6);
    });

    it('每张马应有类型为装备牌', () => {
      for (const horse of horses) {
        expect(horse.type).toBe('装备牌');
      }
    });

    it('每张马应有子类型为进攻马或防御马', () => {
      for (const horse of horses) {
        expect(['进攻马', '防御马']).toContain(horse.subtype);
      }
    });

    it('应有3张进攻马和3张防御马', () => {
      const offensiveHorses = horses.filter(m => m.subtype === '进攻马');
      const defensiveHorses = horses.filter(m => m.subtype === '防御马');
      expect(offensiveHorses.length).toBe(3);
      expect(defensiveHorses.length).toBe(3);
    });
  });
});

describe('锦囊牌', () => {
  describe('普通锦囊', () => {
    it('应该有8种普通锦囊', () => {
      expect(normalTricks.length).toBe(8);
    });

    it('每张锦囊应有类型为锦囊牌', () => {
      for (const trick of normalTricks) {
        expect(trick.type).toBe('锦囊牌');
      }
    });

    it('每张锦囊应有子类型为锦囊', () => {
      for (const trick of normalTricks) {
        expect(trick.subtype).toBe('锦囊');
      }
    });

    it('每张锦囊应有锦囊子类型为普通锦囊', () => {
      for (const trick of normalTricks) {
        expect(trick.trickSubtype).toBe('普通锦囊');
      }
    });

    it('每张锦囊应有描述', () => {
      for (const trick of normalTricks) {
        expect(trick.description).toBeDefined();
        expect(trick.description.length).toBeGreaterThan(0);
      }
    });

    it('锦囊名应唯一', () => {
      const nameList = normalTricks.map(t => t.name);
      const uniqueNames = new Set(nameList);
      expect(uniqueNames.size).toBe(nameList.length);
    });
  });

  describe('延时锦囊', () => {
    it('应该有3种延时锦囊', () => {
      expect(delayedTricks.length).toBe(3);
    });

    it('每张延时锦囊应有锦囊子类型为延时锦囊', () => {
      for (const trick of delayedTricks) {
        expect(trick.trickSubtype).toBe('延时锦囊');
      }
    });

    it('延时锦囊名应唯一', () => {
      const nameList = delayedTricks.map(t => t.name);
      const uniqueNames = new Set(nameList);
      expect(uniqueNames.size).toBe(nameList.length);
    });
  });

  describe('响应锦囊', () => {
    it('应该有1种响应锦囊', () => {
      expect(reactiveTricks.length).toBe(1);
    });

    it('无懈可击应有正确类型', () => {
      expect(reactiveTricks[0].name).toBe('无懈可击');
      expect(reactiveTricks[0].trickSubtype).toBe('响应锦囊');
    });
  });

  describe('所有锦囊', () => {
    it('应该有12种锦囊牌', () => {
      expect(allTricks.length).toBe(12);
    });
  });
});

describe('标准牌堆', () => {
  it('应包含基本牌、装备牌和锦囊牌', () => {
    const deck = createDeck();
    const basicCards = deck.filter(c => c.type === '基本牌');
    const equipmentCards = deck.filter(c => c.type === '装备牌');
    const trickCards = deck.filter(c => c.type === '锦囊牌');

    expect(basicCards.length).toBeGreaterThan(0);
    expect(equipmentCards.length).toBeGreaterThan(0);
    expect(trickCards.length).toBeGreaterThan(0);
  });

  it('应包含所有武器', () => {
    const deck = createDeck();
    const weaponNames = weapons.map(w => w.name);

    for (const weaponName of weaponNames) {
      const found = deck.some(c => c.name === weaponName && c.subtype === '武器');
      expect(found).toBe(true);
    }
  });

  it('应包含所有防具', () => {
    const deck = createDeck();
    const armorNames = armors.map(a => a.name);

    for (const armorName of armorNames) {
      const found = deck.some(c => c.name === armorName && c.subtype === '防具');
      expect(found).toBe(true);
    }
  });

  it('应包含所有锦囊', () => {
    const deck = createDeck();
    const trickNames = allTricks.map(t => t.name);

    for (const trickName of trickNames) {
      const found = deck.some(c => c.name === trickName && c.type === '锦囊牌');
      expect(found).toBe(true);
    }
  });
});

describe('卡牌分类辅助函数', () => {
  it('isWeapon应正确识别', () => {
    expect(isWeapon(weapons[0])).toBe(true);
    expect(isWeapon(armors[0])).toBe(false);
  });

  it('isArmor应正确识别', () => {
    expect(isArmor(armors[0])).toBe(true);
    expect(isArmor(weapons[0])).toBe(false);
  });

  it('isHorse应正确识别', () => {
    expect(isHorse(horses[0])).toBe(true);
    expect(isHorse(weapons[0])).toBe(false);
  });

  it('isEquipment应正确识别', () => {
    expect(isEquipment(weapons[0])).toBe(true);
    expect(isEquipment(armors[0])).toBe(true);
    expect(isEquipment(horses[0])).toBe(true);
    expect(isEquipment(normalTricks[0])).toBe(false);
  });

  it('isTrick应正确识别', () => {
    expect(isTrick(normalTricks[0])).toBe(true);
    expect(isTrick(delayedTricks[0])).toBe(true);
    expect(isTrick(weapons[0])).toBe(false);
  });

  it('isDelayedTrick应正确识别', () => {
    expect(isDelayedTrick(delayedTricks[0])).toBe(true);
    expect(isDelayedTrick(normalTricks[0])).toBe(false);
  });

  it('isBlackSuit应正确识别', () => {
    expect(isBlackSuit({ name: '测试', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' })).toBe(true);
    expect(isBlackSuit({ name: '测试', type: '基本牌', subtype: '杀', suit: '♣', rank: 'A', description: '' })).toBe(true);
    expect(isBlackSuit({ name: '测试', type: '基本牌', subtype: '杀', suit: '♥', rank: 'A', description: '' })).toBe(false);
    expect(isBlackSuit({ name: '测试', type: '基本牌', subtype: '杀', suit: '♦', rank: 'A', description: '' })).toBe(false);
  });

  it('isRedSuit应正确识别', () => {
    expect(isRedSuit({ name: '测试', type: '基本牌', subtype: '杀', suit: '♥', rank: 'A', description: '' })).toBe(true);
    expect(isRedSuit({ name: '测试', type: '基本牌', subtype: '杀', suit: '♦', rank: 'A', description: '' })).toBe(true);
    expect(isRedSuit({ name: '测试', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' })).toBe(false);
    expect(isRedSuit({ name: '测试', type: '基本牌', subtype: '杀', suit: '♣', rank: 'A', description: '' })).toBe(false);
  });
});
