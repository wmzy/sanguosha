// @vitest-environment jsdom
// tests/client/skillDisplay.test.ts
// displaySkillName 单测:仅剥离前导单个"界",标版技能名不变。
//
// 归入 tests/client/(与 src/client/utils/skillDisplay.ts 1:1 对应,
// 同 playerIdentity.ts ↔ playerIdentity.test.ts 的约定)。
import { describe, it, expect } from 'vitest';
import { displaySkillName } from '../../src/client/utils/skillDisplay';

describe('displaySkillName', () => {
  it('去掉界版本技能名前导单个"界"', () => {
    expect(displaySkillName('界英姿')).toBe('英姿');
    expect(displaySkillName('界魂姿')).toBe('魂姿');
    expect(displaySkillName('界制衡')).toBe('制衡');
    expect(displaySkillName('界激昂')).toBe('激昂');
  });

  it('保留技能名中段/后置的"界"(只剥前导一个)', () => {
    // "界护驾·摸牌" 这种带后缀标签的:只去前导"界" → "护驾·摸牌"
    expect(displaySkillName('界护驾·摸牌')).toBe('护驾·摸牌');
  });

  it('标版技能名(不含"界"前缀)原样返回', () => {
    expect(displaySkillName('英姿')).toBe('英姿');
    expect(displaySkillName('制衡')).toBe('制衡');
    expect(displaySkillName('杀')).toBe('杀');
    expect(displaySkillName('桃园结义')).toBe('桃园结义');
    // 名字内部含"界"但不是前缀的(理论上不存在,但保证不误伤)
    expect(displaySkillName('无敌界王')).toBe('无敌界王');
  });

  it('空串与纯"界"的边界', () => {
    expect(displaySkillName('')).toBe('');
    // 纯"界"字符:剥前导后为空串
    expect(displaySkillName('界')).toBe('');
  });

  it('不递归剥离(只去前导一个"界")', () => {
    // "界界X" 这种(实际数据不存在,但锁定"只剥一个"的语义)
    expect(displaySkillName('界界X')).toBe('界X');
  });
});
