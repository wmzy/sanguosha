// tests/unit/卡牌扩展.test.ts
import { describe, it, expect } from 'vitest';
import {
  所有武器, 所有防具, 所有马, 所有锦囊,
  所有普通锦囊, 所有延时锦囊, 所有响应锦囊,
  创建标准牌堆,
  是武器牌, 是防具牌, 是马牌, 是装备牌, 是锦囊牌, 是延时锦囊,
  是黑色花色, 是红色花色,
} from '@shared/卡牌';

describe('装备牌', () => {
  describe('武器牌', () => {
    it('应该有8种武器', () => {
      expect(所有武器.length).toBe(8);
    });

    it('每张武器应有name字段', () => {
      for (const 武器 of 所有武器) {
        expect(武器.name).toBeDefined();
        expect(typeof 武器.name).toBe('string');
        expect(武器.name.length).toBeGreaterThan(0);
      }
    });

    it('每张武器应有类型为装备牌', () => {
      for (const 武器 of 所有武器) {
        expect(武器.类型).toBe('装备牌');
      }
    });

    it('每张武器应有子类型为武器', () => {
      for (const 武器 of 所有武器) {
        expect(武器.子类型).toBe('武器');
      }
    });

    it('每张武器应有距离字段', () => {
      for (const 武器 of 所有武器) {
        expect(武器.距离).toBeDefined();
        expect(typeof 武器.距离).toBe('number');
        expect(武器.距离!).toBeGreaterThan(0);
      }
    });

    it('每张武器应有花色和点数', () => {
      for (const 武器 of 所有武器) {
        expect(['♠', '♥', '♣', '♦']).toContain(武器.花色);
        expect(武器.点数).toBeDefined();
      }
    });

    it('每张武器应有描述', () => {
      for (const 武器 of 所有武器) {
        expect(武器.描述).toBeDefined();
        expect(typeof 武器.描述).toBe('string');
        expect(武器.描述.length).toBeGreaterThan(0);
      }
    });

    it('武器名应唯一', () => {
      const 名字列表 = 所有武器.map(w => w.name);
      const 唯一名字 = new Set(名字列表);
      expect(唯一名字.size).toBe(名字列表.length);
    });
  });

  describe('防具牌', () => {
    it('应该有2种防具', () => {
      expect(所有防具.length).toBe(2);
    });

    it('每张防具应有类型为装备牌', () => {
      for (const 防具 of 所有防具) {
        expect(防具.类型).toBe('装备牌');
      }
    });

    it('每张防具应有子类型为防具', () => {
      for (const 防具 of 所有防具) {
        expect(防具.子类型).toBe('防具');
      }
    });

    it('每张防具应有描述', () => {
      for (const 防具 of 所有防具) {
        expect(防具.描述).toBeDefined();
        expect(防具.描述.length).toBeGreaterThan(0);
      }
    });
  });

  describe('马牌', () => {
    it('应该有6种马', () => {
      expect(所有马.length).toBe(6);
    });

    it('每张马应有类型为装备牌', () => {
      for (const 马 of 所有马) {
        expect(马.类型).toBe('装备牌');
      }
    });

    it('每张马应有子类型为进攻马或防御马', () => {
      for (const 马 of 所有马) {
        expect(['进攻马', '防御马']).toContain(马.子类型);
      }
    });

    it('应有3张进攻马和3张防御马', () => {
      const 进攻马 = 所有马.filter(m => m.子类型 === '进攻马');
      const 防御马 = 所有马.filter(m => m.子类型 === '防御马');
      expect(进攻马.length).toBe(3);
      expect(防御马.length).toBe(3);
    });
  });
});

describe('锦囊牌', () => {
  describe('普通锦囊', () => {
    it('应该有8种普通锦囊', () => {
      expect(所有普通锦囊.length).toBe(8);
    });

    it('每张锦囊应有类型为锦囊牌', () => {
      for (const 锦囊 of 所有普通锦囊) {
        expect(锦囊.类型).toBe('锦囊牌');
      }
    });

    it('每张锦囊应有子类型为锦囊', () => {
      for (const 锦囊 of 所有普通锦囊) {
        expect(锦囊.子类型).toBe('锦囊');
      }
    });

    it('每张锦囊应有锦囊子类型为普通锦囊', () => {
      for (const 锦囊 of 所有普通锦囊) {
        expect(锦囊.锦囊子类型).toBe('普通锦囊');
      }
    });

    it('每张锦囊应有描述', () => {
      for (const 锦囊 of 所有普通锦囊) {
        expect(锦囊.描述).toBeDefined();
        expect(锦囊.描述.length).toBeGreaterThan(0);
      }
    });

    it('锦囊名应唯一', () => {
      const 名字列表 = 所有普通锦囊.map(t => t.name);
      const 唯一名字 = new Set(名字列表);
      expect(唯一名字.size).toBe(名字列表.length);
    });
  });

  describe('延时锦囊', () => {
    it('应该有3种延时锦囊', () => {
      expect(所有延时锦囊.length).toBe(3);
    });

    it('每张延时锦囊应有锦囊子类型为延时锦囊', () => {
      for (const 锦囊 of 所有延时锦囊) {
        expect(锦囊.锦囊子类型).toBe('延时锦囊');
      }
    });

    it('延时锦囊名应唯一', () => {
      const 名字列表 = 所有延时锦囊.map(t => t.name);
      const 唯一名字 = new Set(名字列表);
      expect(唯一名字.size).toBe(名字列表.length);
    });
  });

  describe('响应锦囊', () => {
    it('应该有1种响应锦囊', () => {
      expect(所有响应锦囊.length).toBe(1);
    });

    it('无懈可击应有正确类型', () => {
      expect(所有响应锦囊[0].name).toBe('无懈可击');
      expect(所有响应锦囊[0].锦囊子类型).toBe('响应锦囊');
    });
  });

  describe('所有锦囊', () => {
    it('应该有12种锦囊牌', () => {
      expect(所有锦囊.length).toBe(12);
    });
  });
});

describe('标准牌堆', () => {
  it('应包含基本牌、装备牌和锦囊牌', () => {
    const 牌堆 = 创建标准牌堆();
    const 基本牌 = 牌堆.filter(c => c.类型 === '基本牌');
    const 装备牌 = 牌堆.filter(c => c.类型 === '装备牌');
    const 锦囊牌 = 牌堆.filter(c => c.类型 === '锦囊牌');

    expect(基本牌.length).toBeGreaterThan(0);
    expect(装备牌.length).toBeGreaterThan(0);
    expect(锦囊牌.length).toBeGreaterThan(0);
  });

  it('应包含所有武器', () => {
    const 牌堆 = 创建标准牌堆();
    const 武器名列表 = 所有武器.map(w => w.name);

    for (const 武器名 of 武器名列表) {
      const 找到 = 牌堆.some(c => c.name === 武器名 && c.子类型 === '武器');
      expect(找到).toBe(true);
    }
  });

  it('应包含所有防具', () => {
    const 牌堆 = 创建标准牌堆();
    const 防具名列表 = 所有防具.map(a => a.name);

    for (const 防具名 of 防具名列表) {
      const 找到 = 牌堆.some(c => c.name === 防具名 && c.子类型 === '防具');
      expect(找到).toBe(true);
    }
  });

  it('应包含所有锦囊', () => {
    const 牌堆 = 创建标准牌堆();
    const 锦囊名列表 = 所有锦囊.map(t => t.name);

    for (const 锦囊名 of 锦囊名列表) {
      const 找到 = 牌堆.some(c => c.name === 锦囊名 && c.类型 === '锦囊牌');
      expect(找到).toBe(true);
    }
  });
});

describe('卡牌分类辅助函数', () => {
  it('是武器牌应正确识别', () => {
    expect(是武器牌(所有武器[0])).toBe(true);
    expect(是武器牌(所有防具[0])).toBe(false);
  });

  it('是防具牌应正确识别', () => {
    expect(是防具牌(所有防具[0])).toBe(true);
    expect(是防具牌(所有武器[0])).toBe(false);
  });

  it('是马牌应正确识别', () => {
    expect(是马牌(所有马[0])).toBe(true);
    expect(是马牌(所有武器[0])).toBe(false);
  });

  it('是装备牌应正确识别', () => {
    expect(是装备牌(所有武器[0])).toBe(true);
    expect(是装备牌(所有防具[0])).toBe(true);
    expect(是装备牌(所有马[0])).toBe(true);
    expect(是装备牌(所有普通锦囊[0])).toBe(false);
  });

  it('是锦囊牌应正确识别', () => {
    expect(是锦囊牌(所有普通锦囊[0])).toBe(true);
    expect(是锦囊牌(所有延时锦囊[0])).toBe(true);
    expect(是锦囊牌(所有武器[0])).toBe(false);
  });

  it('是延时锦囊应正确识别', () => {
    expect(是延时锦囊(所有延时锦囊[0])).toBe(true);
    expect(是延时锦囊(所有普通锦囊[0])).toBe(false);
  });

  it('是黑色花色应正确识别', () => {
    expect(是黑色花色({ name: '测试', 类型: '基本牌', 子类型: '杀', 花色: '♠', 点数: 'A', 描述: '' })).toBe(true);
    expect(是黑色花色({ name: '测试', 类型: '基本牌', 子类型: '杀', 花色: '♣', 点数: 'A', 描述: '' })).toBe(true);
    expect(是黑色花色({ name: '测试', 类型: '基本牌', 子类型: '杀', 花色: '♥', 点数: 'A', 描述: '' })).toBe(false);
    expect(是黑色花色({ name: '测试', 类型: '基本牌', 子类型: '杀', 花色: '♦', 点数: 'A', 描述: '' })).toBe(false);
  });

  it('是红色花色应正确识别', () => {
    expect(是红色花色({ name: '测试', 类型: '基本牌', 子类型: '杀', 花色: '♥', 点数: 'A', 描述: '' })).toBe(true);
    expect(是红色花色({ name: '测试', 类型: '基本牌', 子类型: '杀', 花色: '♦', 点数: 'A', 描述: '' })).toBe(true);
    expect(是红色花色({ name: '测试', 类型: '基本牌', 子类型: '杀', 花色: '♠', 点数: 'A', 描述: '' })).toBe(false);
    expect(是红色花色({ name: '测试', 类型: '基本牌', 子类型: '杀', 花色: '♣', 点数: 'A', 描述: '' })).toBe(false);
  });
});
