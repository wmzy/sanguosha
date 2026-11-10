// 资源映射 helper 的单元测试。
// 覆盖:getCharacterImage / getCardImage / getEquipCardImage / resolveSoundUrl。
// Task 5 后：这些 helper 委托 ResourceManager，测试需注入 manifest。

import { describe, expect, it, beforeEach } from 'vitest';
import { getCardImage, getCardArtImage, getCharacterImage, getEquipCardImage } from '../../src/client/assets/imageAssets';
import { resolveSoundUrl } from '../../src/client/sounds/soundMap';
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
        { id: 'character/关羽', type: 'image' },
        { id: 'character/诸葛亮', type: 'image' },
        { id: 'character/张昭张纮', type: 'image' },
        { id: 'character/甄姬', type: 'image' },
        { id: 'character/界刘备', type: 'image', file: 'character/界刘备_special.png' },
        // basic 牌用显式 .jpg file
        { id: 'card/杀-10-♠', type: 'image', file: 'card/杀-10-♠.jpg' },
        { id: 'card/杀-4-♥', type: 'image', file: 'card/杀-4-♥.jpg' },
        { id: 'card/闪-2-♥', type: 'image', file: 'card/闪-2-♥.jpg' },
        { id: 'card/art/杀', type: 'image', file: 'image/card/slash.png' },
        { id: 'card/art/火杀', type: 'image', file: 'image/card/fire_slash.png' },
        // equipment/trick 牌省略 file（默认 .png）
        { id: 'card/丈八蛇矛-Q-♠', type: 'image' },
        { id: 'card/赤兔-5-♥', type: 'image' },
        { id: 'card/桃园结义-A-♥', type: 'image' },
        { id: 'card/闪电-A-♠', type: 'image' },
        // 装备区缩略图
        { id: 'card/equipment/丈八蛇矛', type: 'image' },
        { id: 'card/equipment/诸葛连弩', type: 'image' },
        { id: 'card/equipment/赤兔', type: 'image' },
        // 音效资源（resolveSoundUrl 测试）
        { id: 'sound/flip', type: 'audio' },
        { id: 'sound/card/杀', type: 'audio' },
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

  it('界限突破武将在无独立立绘时自动无缝回退至标准版立绘', () => {
    // 界曹操、界关羽未单独注册，回退至曹操、关羽
    expect(getCharacterImage('界曹操')).toBe('/packs/base/character/曹操.png');
    expect(getCharacterImage('界关羽')).toBe('/packs/base/character/关羽.png');
    expect(getCharacterImage('界诸葛亮')).toBe('/packs/base/character/诸葛亮.png');
  });

  it('当存在独立界限突破立绘时优先使用独立立绘', () => {
    // 界刘备单独注册了界刘备_special.png
    expect(getCharacterImage('界刘备')).toBe('/packs/base/character/界刘备_special.png');
    // 标准版刘备仍使用标准版
    expect(getCharacterImage('刘备')).toBe('/packs/base/character/刘备.png');
  });

  it('支持武将别名及同系武将立绘自动回退', () => {
    // 卧龙诸葛亮 -> 卧龙诸葛 -> 诸葛亮
    expect(getCharacterImage('卧龙诸葛亮')).toBe('/packs/base/character/诸葛亮.png');
    // 界卧龙诸葛 -> 卧龙诸葛 -> 诸葛亮
    expect(getCharacterImage('界卧龙诸葛')).toBe('/packs/base/character/诸葛亮.png');
    // 诸葛瞻 -> 诸葛亮
    expect(getCharacterImage('诸葛瞻')).toBe('/packs/base/character/诸葛亮.png');
    // 张昭张弘 -> 张昭张纮
    expect(getCharacterImage('张昭张弘')).toBe('/packs/base/character/张昭张纮.png');
    // 界张昭张弘 -> 张昭张弘 -> 张昭张纮
    expect(getCharacterImage('界张昭张弘')).toBe('/packs/base/character/张昭张纮.png');
    // 界郭皇后 -> 郭皇后 -> 甄姬
    expect(getCharacterImage('界郭皇后')).toBe('/packs/base/character/甄姬.png');
  });

  it('returns null for unregistered character', () => {
    expect(getCharacterImage('不存在')).toBeNull();
  });

  it('returns null only for empty name', () => {
    expect(getCharacterImage('')).toBeNull();
  });

  it('界限突破武将若其标准版武将亦未注册则返回 null', () => {
    expect(getCharacterImage('界不存在')).toBeNull();
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

  it('通用图保留属性杀的牌面区分，并回退到已安装的普通牌面', () => {
    expect(getCardArtImage('杀', '火焰')).toBe('/packs/base/image/card/fire_slash.png');
    expect(getCardArtImage('杀', '雷电')).toBe('/packs/base/image/card/slash.png');
    expect(getCardArtImage('无中生有')).toBeNull();
    // 精确花色点数牌面仍有独立优先入口，不被通用图取代。
    expect(getCardImage({ name: '杀', suit: '♠', rank: '10' })).toBe('/packs/base/card/杀-10-♠.jpg');
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

describe('resolveSoundUrl', () => {
  beforeEach(() => {
    resourceManager.reset();
    resourceManager.loadIndex(testIndex);
    resourceManager.setPackEnabled('base', true);
  });

  it('委托 ResourceManager 解析已注册音效并补 .mp3 后缀', () => {
    expect(resolveSoundUrl('flip')).toBe('/packs/base/sound/flip.mp3');
    expect(resolveSoundUrl('card/杀')).toBe('/packs/base/sound/card/杀.mp3');
  });

  it('未注册音效返回 null', () => {
    expect(resolveSoundUrl('unknown_id')).toBeNull();
  });
});
