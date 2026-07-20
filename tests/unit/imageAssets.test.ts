// tests/unit/imageAssets.test.ts
// 图片资源映射 helper 的单元测试。
// 覆盖:getCharacterImage / getCardImage 对已实现武将与卡牌的命中,以及缺失时的回退。
// 命中即保证前端各组件引用的 URL 在 public/ 下存在。

import { describe, expect, it } from 'vitest';
import { getCardImage, getCharacterImage } from '../../src/client/assets/imageAssets';

describe('getCharacterImage', () => {
  it('returns URL for standard heroes with portrait assets', () => {
    expect(getCharacterImage('曹操')).toBe('/characters/曹操.png');
    expect(getCharacterImage('刘备')).toBe('/characters/刘备.png');
    expect(getCharacterImage('诸葛亮')).toBe('/characters/诸葛亮.png');
  });

  it('returns URL for 界限突破 heroes (区分同前缀的标准武将)', () => {
    expect(getCharacterImage('界曹操')).toBe('/characters/界曹操.png');
    expect(getCharacterImage('界卧龙诸葛')).toBe('/characters/界卧龙诸葛.png');
  });

  it('returns URL for 张昭张纮 dual hero', () => {
    expect(getCharacterImage('张昭张纮')).toBe('/characters/张昭张纮.png');
  });

  it('returns null for unimplemented / unknown heroes', () => {
    expect(getCharacterImage('')).toBeNull();
    expect(getCharacterImage('神诸葛亮')).toBeNull();
    expect(getCharacterImage('SP刘备')).toBeNull();
    expect(getCharacterImage('不存在的武将')).toBeNull();
  });
});

describe('getCardImage', () => {
  // 卡牌图统一走 /cards/<...>;本地覆盖(public/cards-local/)由 Vite 中间件服务端处理,
  // 前端永远只请求 /cards/<name>。
  it('routes basic cards to /cards/basic/ with .jpg', () => {
    expect(getCardImage('杀')).toBe('/cards/basic/杀.jpg');
    expect(getCardImage('闪')).toBe('/cards/basic/闪.jpg');
    expect(getCardImage('火杀')).toBe('/cards/basic/火杀.jpg');
    expect(getCardImage('雷杀')).toBe('/cards/basic/雷杀.jpg');
  });

  it('routes equipment cards to /cards/equipment/ with .png', () => {
    expect(getCardImage('诸葛连弩')).toBe('/cards/equipment/诸葛连弩.png');
    expect(getCardImage('丈八蛇矛')).toBe('/cards/equipment/丈八蛇矛.png');
    expect(getCardImage('八卦阵')).toBe('/cards/equipment/八卦阵.png');
    expect(getCardImage('+1坐骑')).toBe('/cards/equipment/+1坐骑.png');
    expect(getCardImage('-1坐骑')).toBe('/cards/equipment/-1坐骑.png');
  });

  it('routes trick cards to /cards/trick/ with .png', () => {
    expect(getCardImage('南蛮入侵')).toBe('/cards/trick/南蛮入侵.png');
    expect(getCardImage('无懈可击')).toBe('/cards/trick/无懈可击.png');
    expect(getCardImage('乐不思蜀')).toBe('/cards/trick/乐不思蜀.png');
    expect(getCardImage('闪电')).toBe('/cards/trick/闪电.png');
  });

  it('returns null for unknown cards (引擎未实现的扩展卡)', () => {
    expect(getCardImage('')).toBeNull();
    expect(getCardImage('不存在')).toBeNull();
  });
});
