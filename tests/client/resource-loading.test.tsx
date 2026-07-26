// tests/client/resource-loading.test.tsx
// 验证 imageAssets 三函数 + soundMap.resolveSoundUrl 正确委托 ResourceManager。
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { resourceManager } from '../../src/client/resources';
import { getCharacterImage, getCardImage, getEquipCardImage } from '../../src/client/assets/imageAssets';
import { resolveSoundUrl } from '../../src/client/sounds/soundMap';
import type { PacksIndex } from '../../src/client/resources/types';

describe('加载层委托 ResourceManager', () => {
  beforeEach(() => {
    resourceManager.reset();
    const index: PacksIndex = {
      packs: [{
        id: 'base', manifest: {
          manifestVersion: 1, id: 'base', name: 'base', version: '1.0.0',
          author: 't', priority: 0,
          resources: [
            { id: 'character/曹操', type: 'image' },
            { id: 'card/杀-7-♠', type: 'image', file: 'card/杀-7-♠.jpg' },
            { id: 'card/equipment/丈八蛇矛', type: 'image' },
            { id: 'sound/play_card', type: 'audio' },
          ],
        },
      }],
    };
    resourceManager.loadIndex(index);
    resourceManager.setPackEnabled('base', true);
  });

  it('getCharacterImage 返回 ResourceManager 解析的 URL', () => {
    expect(getCharacterImage('曹操')).toBe('/packs/base/character/曹操.png');
  });

  it('getCharacterImage 空名返回 null', () => {
    expect(getCharacterImage('')).toBeNull();
  });

  it('getCardImage 拼接 名-点-花色', () => {
    expect(getCardImage({ name: '杀', rank: '7', suit: '♠' })).toBe('/packs/base/card/杀-7-♠.jpg');
  });

  it('getCardImage 缺字段返回 null', () => {
    expect(getCardImage({ name: '杀' })).toBeNull();
    expect(getCardImage({ name: '杀', rank: '7' })).toBeNull();
  });

  it('getEquipCardImage 返回 equipment 子路径', () => {
    expect(getEquipCardImage('丈八蛇矛')).toBe('/packs/base/card/equipment/丈八蛇矛.png');
  });

  it('resolveSoundUrl 委托 ResourceManager', () => {
    expect(resolveSoundUrl('play_card')).toBe('/packs/base/sound/play_card.mp3');
    expect(resolveSoundUrl('unknown_id')).toBeNull();
  });
});
