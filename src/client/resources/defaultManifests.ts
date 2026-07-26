// src/client/resources/defaultManifests.ts
// 内置 base 包的兜底 manifest。
// 当 public/packs/base/ 目录不存在或无 manifest.json 时，ResourceManager 用此兜底，
// 保证"克隆后无资源也能启动"（所有 get() 返回 null，走 fallback）。

import type { Manifest } from './types';

export const BASE_PACK_ID = 'base';

export const BASE_PACK_FALLBACK_MANIFEST: Manifest = {
  manifestVersion: 1,
  id: BASE_PACK_ID,
  name: '基础资源包',
  version: '1.0.0',
  author: '内置',
  description: '游戏自带的基础视听资源（图片/音频/特效）',
  priority: 0,
  resources: [], // 空：实际资源由文件系统扫描填充
};
