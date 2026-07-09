// tests/engine/card-meta.test.ts
// 卡牌元数据查询函数覆盖率补充
import { describe, it, expect } from 'vitest';
import {
  isEquipment,
  isDelayedTrick,
  isRespondOnly,
  getWeaponRange,
  getEquipmentSkillNames,
} from '../../src/engine/card-meta';
import type { Card } from '../../src/engine/types';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'test-1',
    name: '杀',
    suit: '♠',
    color: '黑',
    rank: '7',
    type: '基本牌',
    ...overrides,
  };
}

describe('isEquipment', () => {
  it('装备牌返回 true', () => {
    expect(isEquipment(makeCard({ type: '装备牌' }))).toBe(true);
  });

  it('基本牌返回 false', () => {
    expect(isEquipment(makeCard({ type: '基本牌' }))).toBe(false);
  });

  it('锦囊牌返回 false', () => {
    expect(isEquipment(makeCard({ type: '锦囊牌' }))).toBe(false);
  });
});

describe('isDelayedTrick', () => {
  it('延时锦囊返回 true', () => {
    expect(
      isDelayedTrick(makeCard({ type: '锦囊牌', trickSubtype: '延时锦囊' })),
    ).toBe(true);
  });

  it('普通锦囊返回 false', () => {
    expect(
      isDelayedTrick(makeCard({ type: '锦囊牌', trickSubtype: '普通锦囊' })),
    ).toBe(false);
  });

  it('响应锦囊返回 false', () => {
    expect(
      isDelayedTrick(makeCard({ type: '锦囊牌', trickSubtype: '响应锦囊' })),
    ).toBe(false);
  });

  it('非锦囊牌返回 false', () => {
    expect(isDelayedTrick(makeCard({ type: '装备牌' }))).toBe(false);
    expect(isDelayedTrick(makeCard({ type: '基本牌' }))).toBe(false);
  });
});

describe('isRespondOnly', () => {
  it('"闪" 返回 true', () => {
    expect(isRespondOnly(makeCard({ name: '闪' }))).toBe(true);
  });

  it('响应锦囊返回 true', () => {
    expect(isRespondOnly(makeCard({ name: '无懈可击', trickSubtype: '响应锦囊' }))).toBe(true);
  });

  it('普通牌返回 false', () => {
    expect(isRespondOnly(makeCard({ name: '杀' }))).toBe(false);
    expect(isRespondOnly(makeCard({ name: '桃园结义', trickSubtype: '普通锦囊' }))).toBe(false);
  });
});

describe('getWeaponRange', () => {
  it('有 range 字段返回该值', () => {
    expect(getWeaponRange(makeCard({ range: 3 }))).toBe(3);
  });

  it('无 range 字段返回默认值 1(徒手)', () => {
    expect(getWeaponRange(makeCard())).toBe(1);
  });

  it('range = 0 不作特殊处理,原样返回', () => {
    // 0 是有效值(不应回退到 1)
    expect(getWeaponRange(makeCard({ range: 0 }))).toBe(0);
  });
});

describe('getEquipmentSkillNames', () => {
  it('返回非空 Set', () => {
    const names = getEquipmentSkillNames();
    expect(names).toBeInstanceOf(Set);
    expect(names.size).toBeGreaterThan(0);
  });

  it('包含有技能的武器(如 诸葛连弩)', () => {
    const names = getEquipmentSkillNames();
    expect(names.has('诸葛连弩')).toBe(true);
  });

  it('不包含非装备牌名称(如基本牌)', () => {
    const names = getEquipmentSkillNames();
    // 基本牌不在 skillLoaders 中
    expect(names.has('杀')).toBe(false);
    expect(names.has('闪')).toBe(false);
  });

  it('多次调用返回同一缓存实例', () => {
    const a = getEquipmentSkillNames();
    const b = getEquipmentSkillNames();
    expect(a).toBe(b);
  });
});
