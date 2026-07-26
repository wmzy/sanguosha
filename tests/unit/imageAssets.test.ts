// 图片资源映射 helper 的单元测试。
// 覆盖:getCharacterImage / getCardImage / getEquipCardImage。
// Task 5 后：三函数委托 ResourceManager，测试需注入 manifest。

import { describe, expect, it, beforeEach } from 'vitest';
import { getCardImage, getCharacterImage, getEquipCardImage } from '../../src/client/assets/imageAssets';
import { resourceManager } from '../../src/client/resources';
import type { PacksIndex } from '../../src/client/resources/types';

const testIndex: PacksIndex = {
  packs: [{
    id: 'base', manifest: {
      manifestVersion: 1, id: 'base', name: 'test', version: '1.0.0',
      author: 't', priority: 0,
      resources: [
        { id: 'character/曹操', type: 'image' },
        { id: 'character/刘备', type: 'image' },
        // basic 牌用显式 .jpg file
        { id: 'card/杀-10-♠', type: 'image', file: 'card/杀-10-♠.jpg' },
        { id: 'card/杀-4-♥', type: 'image', file: 'card/杀-4-♥.jpg' },
        { id: 'card/闪-2-♥', type: 'image', file: 'card/闪-2-♥.jpg' },
        // equipment/trick 牌省略 file（默认 .png）
        { id: 'card/丈八蛇矛-Q-♠', type: 'image' },
        { id: 'card/赤兔-5-♥', type: 'image' },
        { id: 'card/桃园结义-A-♥', type: 'image' },
        { id: 'card/闪电-A-♠', type: 'image' },
        // 装备区缩略图
        { id: 'card/equipment/丈八蛇矛', type: 'image' },
        { id: 'card/equipment/诸葛连弩', type: 'image' },
        { id: 'card/equipment/赤兔', type: 'image' },
      ],
    },
  }],
};

describe('getCharacterImage', () => {
  beforeEach(() => {
    resourceManager.reset();
    resourceManager.loadIndex(testIndex);
    resourceManager.setPackEnabled('base', true);
  });

  it('routes registered character to /packs/base/character/<name>.png', () => {
    expect(getCharacterImage('曹操')).toBe('/packs/base/character/曹操.png');
    expect(getCharacterImage('刘备')).toBe('/packs/base/character/刘备.png');
  });

  it('returns null for unregistered character', () => {
    expect(getCharacterImage('不存在')).toBeNull();
  });

  it('returns null only for empty name', () => {
    expect(getCharacterImage('')).toBeNull();
  });
});

describe('getCardImage', () => {
  beforeEach(() => {
    resourceManager.reset();
    resourceManager.loadIndex(testIndex);
    resourceManager.setPackEnabled('base', true);
  });

  it('routes basic cards with explicit .jpg file', () => {
    expect(getCardImage({ name: '杀', suit: '♠', rank: '10' })).toBe('/packs/base/card/杀-10-♠.jpg');
    expect(getCardImage({ name: '闪', suit: '♥', rank: '2' })).toBe('/packs/base/card/闪-2-♥.jpg');
  });

  it('routes equipment cards with default .png', () => {
    expect(getCardImage({ name: '丈八蛇矛', suit: '♠', rank: 'Q' })).toBe('/packs/base/card/丈八蛇矛-Q-♠.png');
    expect(getCardImage({ name: '赤兔', suit: '♥', rank: '5' })).toBe('/packs/base/card/赤兔-5-♥.png');
  });

  it('routes trick cards with default .png', () => {
    expect(getCardImage({ name: '桃园结义', suit: '♥', rank: 'A' })).toBe('/packs/base/card/桃园结义-A-♥.png');
    expect(getCardImage({ name: '闪电', suit: '♠', rank: 'A' })).toBe('/packs/base/card/闪电-A-♠.png');
  });

  it('returns null when suit or rank is missing', () => {
    expect(getCardImage({ name: '杀' })).toBeNull();
    expect(getCardImage({ name: '杀', suit: '', rank: '' })).toBeNull();
    expect(getCardImage({ name: '杀', suit: '♠' })).toBeNull();
    expect(getCardImage({ name: '杀', rank: '10' })).toBeNull();
  });

  it('returns null for unknown cards', () => {
    expect(getCardImage({ name: '', suit: '♠', rank: '10' })).toBeNull();
    expect(getCardImage({ name: '不存在', suit: '♠', rank: '10' })).toBeNull();
  });

  it('returns null for registered card name but unregistered suit-rank combo', () => {
    // '杀' 在 NAME_TO_SUB 中（basic），但 card/杀-3-♣ 未在 manifest 注册
    expect(getCardImage({ name: '杀', suit: '♣', rank: '3' })).toBeNull();
  });
});

describe('getEquipCardImage', () => {
  beforeEach(() => {
    resourceManager.reset();
    resourceManager.loadIndex(testIndex);
    resourceManager.setPackEnabled('base', true);
  });

  it('routes registered equipment to /packs/base/card/equipment/<name>.png', () => {
    expect(getEquipCardImage('丈八蛇矛')).toBe('/packs/base/card/equipment/丈八蛇矛.png');
    expect(getEquipCardImage('诸葛连弩')).toBe('/packs/base/card/equipment/诸葛连弩.png');
    expect(getEquipCardImage('赤兔')).toBe('/packs/base/card/equipment/赤兔.png');
  });

  it('returns null for non-equipment or unknown cards', () => {
    expect(getEquipCardImage('杀')).toBeNull();
    expect(getEquipCardImage('桃园结义')).toBeNull();
    expect(getEquipCardImage('不存在')).toBeNull();
    expect(getEquipCardImage('')).toBeNull();
  });
});
