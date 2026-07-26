// tests/client/vite-resource-plugin.test.ts
import { describe, it, expect } from 'vitest';
import { buildPacksIndex, resolvePackFile } from '../../src/server/vite-resource-plugin';

describe('vite-resource-plugin 纯函数', () => {
  it('buildPacksIndex 从目录列表构建 index.json', () => {
    const manifests = [
      {
        packId: 'base',
        manifest: {
          manifestVersion: 1 as const, id: 'base', name: 'base', version: '1.0.0',
          author: 't', priority: 0, resources: [],
        },
      },
    ];
    const index = buildPacksIndex(manifests);
    expect(index.packs).toHaveLength(1);
    expect(index.packs[0].id).toBe('base');
  });

  it('resolvePackFile 防目录穿越，拒绝 .. 路径', () => {
    const packsRoot = '/project/public/packs';
    const safe = resolvePackFile(packsRoot, 'base', 'character/曹操.png');
    expect(safe).toBe('/project/public/packs/base/character/曹操.png');
    const evil = resolvePackFile(packsRoot, 'base', '../../../etc/passwd');
    expect(evil).toBeNull();
  });

  it('resolvePackFile 拒绝 packId 含分隔符', () => {
    expect(resolvePackFile('/root', 'a/b', 'x.png')).toBeNull();
  });
});
