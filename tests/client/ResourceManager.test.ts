// tests/client/ResourceManager.test.ts
// ResourceManager 合并逻辑单元测试。
// 测试 init/loadIndex/get/setPackEnabled/listPacks 的纯数据行为，
// 不依赖 fetch（直接调 loadIndex 注入）。

import { describe, it, expect, beforeEach } from 'vitest';
import { resourceManager } from '../../src/client/resources';
import type { PacksIndex } from '../../src/client/resources/types';

describe('ResourceManager', () => {
  beforeEach(() => {
    resourceManager.reset();
  });

  const makeIndex = (
    packs: Array<{
      id: string;
      priority: number;
      resources: Array<{ id: string; type: 'image' }>;
    }>,
  ): PacksIndex => ({
    packs: packs.map((p) => ({
      id: p.id,
      manifest: {
        manifestVersion: 1,
        id: p.id,
        name: p.id,
        version: '1.0.0',
        author: 'test',
        priority: p.priority,
        resources: p.resources,
      },
    })),
  });

  it('get 返回 null 当资源未注册', () => {
    resourceManager.loadIndex(makeIndex([]));
    resourceManager.setPackEnabled('base', true);
    expect(resourceManager.get('character/曹操')).toBeNull();
  });

  it('get 返回正确 URL 当资源已注册且包启用', () => {
    resourceManager.loadIndex(
      makeIndex([
        { id: 'base', priority: 0, resources: [{ id: 'character/曹操', type: 'image' }] },
      ]),
    );
    resourceManager.setPackEnabled('base', true);
    expect(resourceManager.get('character/曹操')).toBe('/packs/base/character/曹操.png');
  });

  it('包禁用时 get 返回 null', () => {
    resourceManager.loadIndex(
      makeIndex([
        { id: 'base', priority: 0, resources: [{ id: 'character/曹操', type: 'image' }] },
      ]),
    );
    resourceManager.setPackEnabled('base', false);
    expect(resourceManager.get('character/曹操')).toBeNull();
  });

  it('高优先级包覆盖低优先级包', () => {
    resourceManager.loadIndex(
      makeIndex([
        { id: 'base', priority: 0, resources: [{ id: 'character/曹操', type: 'image' }] },
        { id: 'skin', priority: 100, resources: [{ id: 'character/曹操', type: 'image' }] },
      ]),
    );
    resourceManager.setPackEnabled('base', true);
    resourceManager.setPackEnabled('skin', true);
    expect(resourceManager.get('character/曹操')).toBe('/packs/skin/character/曹操.png');
  });

  it('显式 file 字段覆盖默认推断路径', () => {
    resourceManager.loadIndex({
      packs: [
        {
          id: 'base',
          manifest: {
            manifestVersion: 1,
            id: 'base',
            name: 'base',
            version: '1.0.0',
            author: 'test',
            priority: 0,
            resources: [{ id: 'character/曹操', type: 'image', file: '曹操/portrait.png' }],
          },
        },
      ],
    });
    resourceManager.setPackEnabled('base', true);
    expect(resourceManager.get('character/曹操')).toBe('/packs/base/曹操/portrait.png');
  });

  it('jpg 文件需显式 file（默认推断为 png）', () => {
    resourceManager.loadIndex({
      packs: [
        {
          id: 'base',
          manifest: {
            manifestVersion: 1,
            id: 'base',
            name: 'base',
            version: '1.0.0',
            author: 'test',
            priority: 0,
            resources: [{ id: 'card/杀-7-♠', type: 'image', file: 'card/杀-7-♠.jpg' }],
          },
        },
      ],
    });
    resourceManager.setPackEnabled('base', true);
    expect(resourceManager.get('card/杀-7-♠')).toBe('/packs/base/card/杀-7-♠.jpg');
  });

  it('listPacks 按 priority 降序返回，含 enabled 标记', () => {
    resourceManager.loadIndex(
      makeIndex([
        { id: 'base', priority: 0, resources: [] },
        {
          id: 'skin',
          priority: 100,
          resources: [{ id: 'character/曹操', type: 'image' }],
        },
      ]),
    );
    resourceManager.setPackEnabled('base', true);
    const list = resourceManager.listPacks();
    expect(list[0].id).toBe('skin');
    expect(list[1].id).toBe('base');
    expect(list[0].resourceCount).toBe(1);
    expect(list[1].enabled).toBe(true);
    expect(list[0].enabled).toBe(false);
  });

  it('loadIndex 注入 base 兜底当无 base 包', () => {
    resourceManager.loadIndex({ packs: [] });
    const list = resourceManager.listPacks();
    expect(list.find((p) => p.id === 'base')).toBeDefined();
  });
});
