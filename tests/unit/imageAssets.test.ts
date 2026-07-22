// 图片资源映射 helper 的单元测试。
// 覆盖:getCharacterImage / getCardImage / getEquipCardImage。

import { describe, expect, it } from 'vitest';
import { getCardImage, getCharacterImage, getEquipCardImage } from '../../src/client/assets/imageAssets';

describe('getCharacterImage', () => {
  // 武将立绘走 /cards-local/characters/<name>.png;任意武将都返回 URL,
  // 文件 404 由 <img onError> 回退到势力色背景(见各武将卡组件)。
  it('routes any character to /cards-local/characters/<name>.png', () => {
    expect(getCharacterImage('曹操')).toBe('/cards-local/characters/曹操.png');
    expect(getCharacterImage('刘备')).toBe('/cards-local/characters/刘备.png');
    // 不维护武将名白名单——任意武将都尝试加载,缺失素材回退势力色背景
    expect(getCharacterImage('不存在')).toBe('/cards-local/characters/不存在.png');
  });

  it('returns null only for empty name', () => {
    expect(getCharacterImage('')).toBeNull();
  });
});

describe('getCardImage', () => {
  // 卡牌图走 /cards-local/<type>/<名>-<点>-<花色>.<ext>;每张物理牌一张图。
  // basic→.jpg, equipment/trick→.png。
  // 图片 404 由 <object> fallback 处理;getCardImage 仅返回 URL 或 null。
  it('routes basic cards to /cards-local/basic/ with name-rank-suit .jpg', () => {
    expect(getCardImage({ name: '杀', suit: '♠', rank: '10' })).toBe('/cards-local/basic/杀-10-♠.jpg');
    expect(getCardImage({ name: '闪', suit: '♥', rank: '2' })).toBe('/cards-local/basic/闪-2-♥.jpg');
    // 火杀:底层 name 仍是「杀」,靠花色点数组合区分(♥4 只可能是火杀)
    expect(getCardImage({ name: '杀', suit: '♥', rank: '4' })).toBe('/cards-local/basic/杀-4-♥.jpg');
  });

  it('routes equipment cards to /cards-local/equipment/ with name-rank-suit .png', () => {
    expect(getCardImage({ name: '丈八蛇矛', suit: '♠', rank: 'Q' })).toBe('/cards-local/equipment/丈八蛇矛-Q-♠.png');
    expect(getCardImage({ name: '赤兔', suit: '♥', rank: '5' })).toBe('/cards-local/equipment/赤兔-5-♥.png');
  });

  it('routes trick cards to /cards-local/trick/ with name-rank-suit', () => {
    expect(getCardImage({ name: '桃园结义', suit: '♥', rank: 'A' })).toBe('/cards-local/trick/桃园结义-A-♥.png');
    expect(getCardImage({ name: '闪电', suit: '♠', rank: 'A' })).toBe('/cards-local/trick/闪电-A-♠.png');
  });

  it('returns null when suit or rank is missing (转化卡/信息不全)', () => {
    expect(getCardImage({ name: '杀' })).toBeNull();
    expect(getCardImage({ name: '杀', suit: '', rank: '' })).toBeNull();
    expect(getCardImage({ name: '杀', suit: '♠' })).toBeNull();
    expect(getCardImage({ name: '杀', rank: '10' })).toBeNull();
  });

  it('returns null for unknown cards', () => {
    expect(getCardImage({ name: '', suit: '♠', rank: '10' })).toBeNull();
    expect(getCardImage({ name: '不存在', suit: '♠', rank: '10' })).toBeNull();
  });
});

describe('getEquipCardImage', () => {
  // 装备区缩略图按牌名查找(一张图对应一种装备),不分花色点数。
  it('routes equipment to /cards-local/equipment/<name>.png', () => {
    expect(getEquipCardImage('丈八蛇矛')).toBe('/cards-local/equipment/丈八蛇矛.png');
    expect(getEquipCardImage('诸葛连弩')).toBe('/cards-local/equipment/诸葛连弩.png');
    expect(getEquipCardImage('赤兔')).toBe('/cards-local/equipment/赤兔.png');
  });

  it('returns null for non-equipment or unknown cards', () => {
    expect(getEquipCardImage('杀')).toBeNull();
    expect(getEquipCardImage('桃园结义')).toBeNull();
    expect(getEquipCardImage('不存在')).toBeNull();
    expect(getEquipCardImage('')).toBeNull();
  });
});
