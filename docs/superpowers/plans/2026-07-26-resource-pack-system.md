# 资源包系统 (Resource Pack System) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立统一的 manifest 驱动资源包系统，让第三方能打包图片/音频/Lottie 特效，通过优先级覆盖机制替换游戏视听表现。

**Architecture:** 全局扁平资源 ID 空间 → manifest 声明资源清单 → Vite 插件聚合成 `/packs/index.json` → `ResourceManager` 单例按优先级合并 → `get(id)` 返回 URL。现有 `imageAssets.ts` 三个函数和 `soundMap.resolveSoundUrl` 改为薄委托，6 处消费点零改动。动画分两类：系统动效（CSS 内置不可打包）+ 特效资源（Lottie JSON 可打包）。

**Tech Stack:** TypeScript, Vite (plugin API), React, Web Audio API, lottie-web (动态 import), Vitest, localStorage

**Spec:** `docs/superpowers/specs/2026-07-26-resource-pack-system-design.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|---|---|
| `src/client/resources/types.ts` | Manifest、ResourceEntry、PackInfo 等 TS 类型 |
| `src/client/resources/ResourceManager.ts` | 单例：合并 manifest、按 ID 查 URL、启停包 |
| `src/client/resources/defaultManifests.ts` | 内置 base 包的 manifest（代码内声明，无文件依赖） |
| `src/client/resources/index.ts` | barrel export |
| `src/server/vite-resource-plugin.ts` | Vite 插件：拦截 `/packs/` 文件请求 + 生成 `/packs/index.json` |
| `src/client/hooks/useResourcePacks.ts` | React hook：初始化 ResourceManager + 包列表 state |
| `src/client/components/PackManagerPanel.tsx` | 资源包管理 UI（启停 toggle） |
| `src/client/hooks/useVfxPlayback.ts` | Lottie 特效播放 hook（监听 ingested，按 effect.vfx 播放） |
| `src/client/components/VfxLayer.tsx` | Lottie 渲染层（独立 z-index，pointer-events:none） |
| `src/client/components/animations.css.ts` | 7 种系统动效 CSS 类（flip/fade/shake/pulse/slide/highlight/flash） |
| `scripts/migrate-to-packs.ts` | 一次性迁移：cards-local + sounds → packs/base |
| `tests/client/ResourceManager.test.ts` | ResourceManager 单元测试 |
| `tests/client/vite-resource-plugin.test.ts` | Vite 插件测试（index.json 生成 + 404 语义） |
| `tests/client/PackManagerPanel.test.tsx` | 管理 UI 测试 |
| `tests/client/resource-loading.test.tsx` | 端到端：imageAssets + soundMap 委托 ResourceManager 验证 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/engine/types/atom.ts` | `AtomEffect` 加 `vfx?: string` 字段 |
| `src/client/sounds/audioEngine.ts` | `resolveSoundUrl` 导入改委托 ResourceManager（经 soundMap 转发） |
| `src/client/sounds/soundMap.ts` | `resolveSoundUrl` 改为 `resourceManager.get('sound/' + id)` 委托 |
| `src/client/assets/imageAssets.ts` | 三个函数改为薄委托 `resourceManager.get(...)` |
| `vite.config.ts` | `cardLocalPlugin()` 替换为 `resourcePlugin()` |
| `src/client/App.tsx` | 初始化 useResourcePacks |
| `src/client/components/GameView.tsx` | 挂 `<VfxLayer>` + `<PackManagerPanel>` 入口 |
| `src/server/vite-card-local-plugin.ts` | **删除**（被 vite-resource-plugin 替换） |

---

## Task 1: 类型定义 (types.ts)

**Files:**
- Create: `src/client/resources/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// src/client/resources/types.ts
// 资源包系统类型定义。

/** 资源类型。决定 manifest 中省略 file 字段时的扩展名推断。 */
export type ResourceType = 'image' | 'audio' | 'lottie';

/** manifest.json 中 resources 数组的单项。 */
export interface ResourceEntry {
  /** 全局资源 ID，如 'character/曹操'、'sound/play_card'、'anim/skill_奸雄' */
  id: string;
  /** 资源类型 */
  type: ResourceType;
  /** 包内相对路径。省略时按 id 推断：image→.png，audio→.mp3，lottie→.json */
  file?: string;
}

/** 资源包 manifest。 */
export interface Manifest {
  /** schema 版本，当前固定 1 */
  manifestVersion: 1;
  /** 全局唯一包 id，kebab-case，用作目录名和引用键 */
  id: string;
  /** 展示名 */
  name: string;
  /** semver */
  version: string;
  /** 作者 */
  author: string;
  /** 可选，UI 展示 */
  description?: string;
  /** 可选，来源链接 */
  homepage?: string;
  /** 优先级，数值大者覆盖小者；内置 base 包默认 0 */
  priority: number;
  /** 资源清单 */
  resources: ResourceEntry[];
}

/** /packs/index.json 的整体结构 */
export interface PacksIndex {
  packs: Array<{ id: string; manifest: Manifest }>;
}

/** 合并后的资源记录。ResourceManager.get 内部用。 */
export interface ResolvedResource {
  /** 提供此资源的包 id */
  packId: string;
  /** 包内相对路径（已解析 file 或推断值） */
  file: string;
}

/** UI 展示用的包信息。 */
export interface PackInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  homepage?: string;
  priority: number;
  /** 资源数 */
  resourceCount: number;
  /** 是否启用（来自 localStorage） */
  enabled: boolean;
}

/** localStorage 'sgs:resource-packs' 的结构 */
export interface PackSettings {
  /** 启用的包 id 列表 */
  enabled: string[];
}
```

- [ ] **Step 2: 验证类型可编译**

Run: `npx tsc --noEmit src/client/resources/types.ts`
Expected: 无错误（独立文件无外部依赖）

- [ ] **Step 3: Commit**

```bash
git add src/client/resources/types.ts
git commit -m "feat(resources): Task 1 - 资源包类型定义"
```

---

## Task 2: AtomEffect 加 vfx 字段

**Files:**
- Modify: `src/engine/types/atom.ts`（在 `AtomEffect` 接口中加字段）

- [ ] **Step 1: 读取现有 AtomEffect 定义**

Run: `grep -n "AtomEffect" src/engine/types/atom.ts`
确认接口位置（约第 33-41 行）。

- [ ] **Step 2: 加 vfx 字段**

在 `animation?: string;` 下一行插入：

```typescript
  vfx?: string;          // Lottie 特效资源 ID，指向 anim/{id}，可打包替换
```

改后 `AtomEffect` 完整形态：

```typescript
export interface AtomEffect {
  sound?: string;
  animation?: string;
  vfx?: string;          // ★ 新增,Lottie 特效资源 ID
  screenEffect?: string;
  particles?: string;
  duration?: number;
  volume?: number;
  blockUntilDone?: boolean;
}
```

- [ ] **Step 3: 验证 tsc 不破**

Run: `npx tsc --noEmit`
Expected: 无新增错误（可选字段，向后兼容）

- [ ] **Step 4: Commit**

```bash
git add src/engine/types/atom.ts
git commit -m "feat(engine): Task 2 - AtomEffect 加 vfx 字段"
```

---
## Task 3: ResourceManager 核心 (TDD)

**Files:**
- Create: `src/client/resources/ResourceManager.ts`
- Create: `src/client/resources/defaultManifests.ts`
- Create: `src/client/resources/index.ts`
- Test: `tests/client/ResourceManager.test.ts`

**职责**：单例，接收 `PacksIndex`，按优先级合并出 `Map<id, ResolvedResource>`，提供 `get(id)` / `setPackEnabled` / `listPacks`。本 task 先不接 fetch/UI/扫描，用注入式 `loadIndex(index)` 测试纯合并逻辑。

- [ ] **Step 1: 写 defaultManifests.ts**

内置 base 包 manifest（代码内声明，作为兜底；实际 packs/base/ 目录的 manifest 覆盖它）：

```typescript
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
  resources: [],  // 空：实际资源由文件系统扫描填充
};
```

- [ ] **Step 2: 写 index.ts barrel**

```typescript
// src/client/resources/index.ts
export { resourceManager, ResourceManager } from './ResourceManager';
export { BASE_PACK_ID } from './defaultManifests';
export type {
  Manifest, ResourceEntry, ResourceType, PacksIndex,
  ResolvedResource, PackInfo, PackSettings,
} from './types';
```

- [ ] **Step 3: 写 ResourceManager 骨架（先放空实现让测试能 import）**

```typescript
// src/client/resources/ResourceManager.ts
// 资源包管理单例：合并多包 manifest，按全局资源 ID 返回 URL。

import type { PacksIndex, Manifest, PackInfo, PackSettings, ResolvedResource } from './types';
import { BASE_PACK_ID, BASE_PACK_FALLBACK_MANIFEST } from './defaultManifests';

const SETTINGS_KEY = 'sgs:resource-packs';

/** 按 ResourceType 推断默认扩展名（manifest 省 file 字段时用） */
function defaultExt(type: ResourceEntry['type']): string {
  return type === 'image' ? '.png' : type === 'audio' ? '.mp3' : '.json';
}

class ResourceManagerClass {
  /** 所有已发现的包（id → manifest） */
  private packs = new Map<string, Manifest>();
  /** 合并后的资源表（id → resolved）。重新合并时整体替换。 */
  private resolved = new Map<string, ResolvedResource>();
  /** 启用的包 id 集合 */
  private enabledSet = new Set<string>();
  private initialized = false;

  /** 加载 PacksIndex（来自 fetch /packs/index.json）。可重复调用（重发现）。 */
  loadIndex(index: PacksIndex): void {
    this.packs.clear();
    for (const { id, manifest } of index.packs) {
      this.packs.set(id, manifest);
    }
    // 兜底：若无 base 包，注入空资源的 fallback
    if (!this.packs.has(BASE_PACK_ID)) {
      this.packs.set(BASE_PACK_ID, BASE_PACK_FALLBACK_MANIFEST);
    }
    this.remerge();
    this.initialized = true;
  }

  /** 按 priority 合并启用的包为 resolved 表。高优先覆盖低优先。 */
  private remerge(): void {
    const table = new Map<string, ResolvedResource>();
    // priority 升序处理（后写覆盖先写），同 priority 按 id 字典序
    const active = [...this.packs.values()]
      .filter((m) => this.enabledSet.has(m.id))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    for (const m of active) {
      for (const entry of m.resources) {
        const file = entry.file ?? `${entry.id}${defaultExt(entry.type)}`;
        table.set(entry.id, { packId: m.id, file });
      }
    }
    this.resolved = table;
  }

  /** 按全局 ID 取资源 URL，无则 null。 */
  get(id: string): string | null {
    const r = this.resolved.get(id);
    if (!r) return null;
    return `/packs/${r.packId}/${r.file}`;
  }

  /** 列出所有已发现包（供 UI 展示）。 */
  listPacks(): PackInfo[] {
    return [...this.packs.values()]
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .map((m) => ({
        id: m.id, name: m.name, version: m.version, author: m.author,
        description: m.description, homepage: m.homepage, priority: m.priority,
        resourceCount: m.resources.length,
        enabled: this.enabledSet.has(m.id),
      }));
  }

  /** 启用/禁用某包，持久化 localStorage，重合并。 */
  setPackEnabled(packId: string, enabled: boolean): void {
    if (!this.packs.has(packId)) return;
    if (enabled) this.enabledSet.add(packId);
    else this.enabledSet.delete(packId);
    this.persistSettings();
    this.remerge();
  }

  /** 从 localStorage 读启用列表。首次默认启用 base 包。 */
  private loadSettings(): void {
    let enabled: string[] | null = null;
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PackSettings;
        if (Array.isArray(parsed.enabled)) enabled = parsed.enabled;
      }
    } catch { /* 损坏数据忽略 */ }
    if (enabled === null) enabled = [BASE_PACK_ID]; // 首次默认启 base
    this.enabledSet = new Set(enabled.filter((id) => this.packs.has(id)));
    this.persistSettings();
  }

  private persistSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: [...this.enabledSet] }));
    } catch { /* 无 localStorage 环境（测试）静默 */ }
  }

  /** 初始化：fetch /packs/index.json + 读 localStorage + 合并。幂等。 */
  async init(): Promise<void> {
    if (this.initialized) return;
    let index: PacksIndex;
    try {
      const res = await fetch('/packs/index.json');
      index = (await res.json()) as PacksIndex;
    } catch {
      index = { packs: [] }; // fetch 失败（离线/无后端）：仅兜底 base
    }
    this.loadIndex(index);
    this.loadSettings();
    this.remerge();
    this.initialized = true;
  }

  /** 测试/重置用。 */
  reset(): void {
    this.packs.clear();
    this.resolved.clear();
    this.enabledSet.clear();
    this.initialized = false;
  }
}

export const resourceManager = new ResourceManagerClass();
export { ResourceManagerClass as ResourceManager };
```

注意：上面 import 行需补 `ResourceEntry` 类型（在 import type 列表加）。修正：

```typescript
import type { PacksIndex, Manifest, PackInfo, PackSettings, ResolvedResource, ResourceEntry } from './types';
```

- [ ] **Step 4: 写失败测试**

```typescript
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

  const makeIndex = (packs: Array<{ id: string; priority: number; resources: Array<{ id: string; type: 'image' }>; }>): PacksIndex => ({
    packs: packs.map((p) => ({
      id: p.id,
      manifest: {
        manifestVersion: 1, id: p.id, name: p.id, version: '1.0.0',
        author: 'test', priority: p.priority, resources: p.resources,
      },
    })),
  });

  it('get 返回 null 当资源未注册', () => {
    resourceManager.loadIndex(makeIndex([]));
    resourceManager.setPackEnabled('base', true);
    expect(resourceManager.get('character/曹操')).toBeNull();
  });

  it('get 返回正确 URL 当资源已注册且包启用', () => {
    resourceManager.loadIndex(makeIndex([
      { id: 'base', priority: 0, resources: [{ id: 'character/曹操', type: 'image' }] },
    ]));
    resourceManager.setPackEnabled('base', true);
    expect(resourceManager.get('character/曹操')).toBe('/packs/base/character/曹操.png');
  });

  it('包禁用时 get 返回 null', () => {
    resourceManager.loadIndex(makeIndex([
      { id: 'base', priority: 0, resources: [{ id: 'character/曹操', type: 'image' }] },
    ]));
    resourceManager.setPackEnabled('base', false);
    expect(resourceManager.get('character/曹操')).toBeNull();
  });

  it('高优先级包覆盖低优先级包', () => {
    resourceManager.loadIndex(makeIndex([
      { id: 'base', priority: 0, resources: [{ id: 'character/曹操', type: 'image' }] },
      { id: 'skin', priority: 100, resources: [{ id: 'character/曹操', type: 'image' }] },
    ]));
    resourceManager.setPackEnabled('base', true);
    resourceManager.setPackEnabled('skin', true);
    expect(resourceManager.get('character/曹操')).toBe('/packs/skin/character/曹操.png');
  });

  it('显式 file 字段覆盖默认推断路径', () => {
    resourceManager.loadIndex({
      packs: [{
        id: 'base', manifest: {
          manifestVersion: 1, id: 'base', name: 'base', version: '1.0.0',
          author: 'test', priority: 0,
          resources: [{ id: 'character/曹操', type: 'image', file: '曹操/portrait.png' }],
        },
      }],
    });
    resourceManager.setPackEnabled('base', true);
    expect(resourceManager.get('character/曹操')).toBe('/packs/base/曹操/portrait.png');
  });

  it('jpg 文件需显式 file（默认推断为 png）', () => {
    resourceManager.loadIndex({
      packs: [{
        id: 'base', manifest: {
          manifestVersion: 1, id: 'base', name: 'base', version: '1.0.0',
          author: 'test', priority: 0,
          resources: [
            { id: 'card/杀-7-♠', type: 'image', file: 'card/杀-7-♠.jpg' },
          ],
        },
      }],
    });
    resourceManager.setPackEnabled('base', true);
    expect(resourceManager.get('card/杀-7-♠')).toBe('/packs/base/card/杀-7-♠.jpg');
  });

  it('listPacks 按 priority 降序返回，含 enabled 标记', () => {
    resourceManager.loadIndex(makeIndex([
      { id: 'base', priority: 0, resources: [] },
      { id: 'skin', priority: 100, resources: [{ id: 'character/曹操', type: 'image' }] },
    ]));
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
```

- [ ] **Step 5: 跑测试确认失败**

Run: `npx vitest run tests/client/ResourceManager.test.ts`
Expected: FAIL（`resourceManager` 未导出或 reset/loadIndex 未实现）

- [ ] **Step 6: 完善实现确保测试通过**

按 Step 3 的代码完整实现（含修正的 import 补 ResourceEntry）。若测试报类型错，按报错修。

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run tests/client/ResourceManager.test.ts`
Expected: PASS（8 个测试全过）

- [ ] **Step 8: Commit**

```bash
git add src/client/resources/ tests/client/ResourceManager.test.ts
git commit -m "feat(resources): Task 3 - ResourceManager 单例 + 合并逻辑"
```

---

## Task 4: Vite 插件 (vite-resource-plugin)

**Files:**
- Create: `src/server/vite-resource-plugin.ts`
- Test: `tests/client/vite-resource-plugin.test.ts`
- Modify: `vite.config.ts`（替换 cardLocalPlugin）

**职责**：
1. 拦截 `/packs/` 文件请求：命中→stream 返回 + 正确 MIME；未命中→404（不让 SPA fallback）。
2. 生成 `/packs/index.json`：dev 用 middleware 实时扫描 `public/packs/*/manifest.json`；prod 用 closeBundle 钩子写入 dist。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/client/vite-resource-plugin.test.ts
// vite-resource-plugin 测试：index.json 生成 + 文件服务 404 语义。
// 不启动真实 Vite，直接调插件暴露的纯函数测试逻辑。

import { describe, it, expect } from 'vitest';
import { buildPacksIndex, resolvePackFile } from '../../src/server/vite-resource-plugin';

describe('vite-resource-plugin 纯函数', () => {
  it('buildPacksIndex 从目录列表构建 index.json', () => {
    // 模拟 packs/base/manifest.json 已读出
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
    expect(evil).toBeNull(); // 穿越 packsRoot 边界返回 null
  });

  it('resolvePackFile 拒绝 packId 含分隔符', () => {
    expect(resolvePackFile('/root', 'a/b', 'x.png')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/client/vite-resource-plugin.test.ts`
Expected: FAIL（模块/函数不存在）

- [ ] **Step 3: 写插件实现**

```typescript
// src/server/vite-resource-plugin.ts
// 资源包 Vite 插件：拦截 /packs/ 文件请求 + 生成 /packs/index.json。
//
// 职责：
//   1. 文件服务：GET /packs/{packId}/{path} → 命中 stream 返回 + MIME；未命中 404（不让 SPA fallback）。
//   2. 包发现：GET /packs/index.json → 扫描 public/packs/*/manifest.json 聚合返回（dev）；
//      closeBundle 钩子写入 dist/packs/index.json（prod）。
//
// 替换原 vite-card-local-plugin.ts。

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, statSync, createReadStream, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize, sep, extname } from 'node:path';
import { createLogger } from './logger';
import type { Manifest, PacksIndex } from '../client/resources/types';

const log = createLogger('resource-pack');

const PUBLIC_DIR = join(process.cwd(), 'public');
const PACKS_DIR = join(PUBLIC_DIR, 'packs');
const DIST_PACKS_DIR = join(process.cwd(), 'dist', 'packs');

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
};

/** 扫描 public/packs/*/manifest.json，聚合成 PacksIndex。 */
export function scanPacksIndex(): PacksIndex {
  const packs: PacksIndex['packs'] = [];
  if (!existsSync(PACKS_DIR)) return { packs };
  for (const entry of readdirSync(PACKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PACKS_DIR, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as Manifest;
      if (manifest && typeof manifest.id === 'string') {
        packs.push({ id: manifest.id, manifest });
      }
    } catch (e) {
      log.error(`解析 manifest 失败: ${manifestPath}: ${(e as Error).message}`);
    }
  }
  return { packs };
}

/** 测试用：从已读 manifests 构建 index。 */
export function buildPacksIndex(items: Array<{ packId: string; manifest: Manifest }>): PacksIndex {
  return { packs: items.map((i) => ({ id: i.packId, manifest: i.manifest })) };
}

/** 解析 /packs/{packId}/{relPath} 的绝对路径。越界（穿越/非法 packId）返回 null。 */
export function resolvePackFile(packsRoot: string, packId: string, relPath: string): string | null {
  // packId 不得含路径分隔符（防 base/../etc）
  if (packId.includes('/') || packId.includes(sep) || packId.includes('\\')) return null;
  const packDir = join(packsRoot, packId);
  const target = normalize(join(packDir, relPath));
  // 必须落在 packDir 内
  if (!target.startsWith(packDir + sep) && target !== packDir) return null;
  return target;
}

export function resourcePlugin(): Plugin {
  const packsExist = existsSync(PACKS_DIR) && statSync(PACKS_DIR).isDirectory();
  if (packsExist) {
    log.info(`检测到 ${PACKS_DIR}，资源包将从此目录提供`);
  }

  return {
    name: 'resource-pack-serve',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? '';
        // 1. 包发现清单
        if (url.split('?')[0] === '/packs/index.json') {
          const index = scanPacksIndex();
          res.setHeader('Content-Type', MIME_BY_EXT['.json']);
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(index));
          return;
        }
        // 2. 文件请求
        if (!url.startsWith('/packs/')) {
          next();
          return;
        }
        const pathPart = url.split('?')[0].slice('/packs/'.length);
        const decoded = decodeURIComponent(pathPart);
        const slashIdx = decoded.indexOf('/');
        if (slashIdx <= 0) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const packId = decoded.slice(0, slashIdx);
        const relPath = decoded.slice(slashIdx + 1);
        const target = resolvePackFile(PACKS_DIR, packId, relPath);
        if (!target || !existsSync(target) || !statSync(target).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const mime = MIME_BY_EXT[extname(target).toLowerCase()] ?? 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(target).pipe(res);
      });
    },
    // 生产构建：把 index.json 写入 dist/packs/
    closeBundle() {
      if (!existsSync(DIST_PACKS_DIR) && existsSync(PACKS_DIR)) {
        mkdirSync(DIST_PACKS_DIR, { recursive: true });
      }
      if (existsSync(PACKS_DIR)) {
        const index = scanPacksIndex();
        writeFileSync(join(DIST_PACKS_DIR, 'index.json'), JSON.stringify(index));
        log.info(`已生成 dist/packs/index.json（${index.packs.length} 个包）`);
      }
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/client/vite-resource-plugin.test.ts`
Expected: PASS（3 个测试）

- [ ] **Step 5: 替换 vite.config.ts 注册**

修改 `vite.config.ts`：
- 删除 `import { cardLocalPlugin } from './src/server/vite-card-local-plugin';`
- 加 `import { resourcePlugin } from './src/server/vite-resource-plugin';`
- `cardLocalPlugin(),` 改为 `resourcePlugin(),`

改后 plugins 数组：

```typescript
  plugins: [
    react({ exclude: ['node_modules/**'] }),
    wyw({
      sourceMap: process.env.NODE_ENV !== 'production',
      displayName: process.env.NODE_ENV !== 'production',
      exclude: ['node_modules/**'],
      evaluate: false,
      babelOptions: { presets: ['@babel/preset-typescript'] },
    }),
    honoApiPlugin(),
    resourcePlugin(),
  ],
```

- [ ] **Step 6: 删除旧插件**

```bash
git rm src/server/vite-card-local-plugin.ts
```

- [ ] **Step 7: 验证 tsc**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 8: Smoke：起 dev 确认路由不崩**

Run: `npm run dev &` → 等启动 → `curl -s http://localhost:3930/packs/index.json` → 期望返回 `{"packs":[]}`（无 packs 目录时）。

- [ ] **Step 9: Commit**

```bash
git add src/server/vite-resource-plugin.ts vite.config.ts tests/client/vite-resource-plugin.test.ts
git rm src/server/vite-card-local-plugin.ts
git commit -m "feat(server): Task 4 - vite-resource-plugin 替换 card-local 插件"
```

---

## Task 5: 加载层迁移 (imageAssets + soundMap 改委托)

**Files:**
- Modify: `src/client/assets/imageAssets.ts`（三个函数改委托）
- Modify: `src/client/sounds/soundMap.ts`（resolveSoundUrl 改委托）
- Test: `tests/client/resource-loading.test.tsx`

**关键约束**：函数签名和返回类型（`string | null`）不变，6 处消费点零改动。

- [ ] **Step 1: 写失败测试**

```typescript
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/client/resource-loading.test.tsx`
Expected: FAIL（现有实现返回旧的 `/cards-local/...` 路径）

- [ ] **Step 3: 改 imageAssets.ts 委托**

整个文件替换为：

```typescript
// src/client/assets/imageAssets.ts
// 武将/卡牌图片资源映射。薄委托 ResourceManager。
//
// 全局 ID 约定（见 docs/superpowers/specs/2026-07-26-resource-pack-system-design.md §3.1）：
//   character/{名}              武将立绘
//   card/{名}-{点}-{花色}       手牌大图
//   card/equipment/{名}         装备区缩略图
//
// 缺失资源（无文件）ResourceManager.get 返回 null，调用方 fallback：
//   - 卡牌：<object> fallback 到 HTML 牌面
//   - 武将：<img onError> fallback 到势力色背景

import { resourceManager } from '../resources';
import { 基本牌列表, 锦囊牌列表, 装备牌列表 } from '../../shared/cards';
import type { CardType } from '../../shared/types';

const NAME_TO_SUB: ReadonlyMap<string, 'basic' | 'equipment' | 'trick'> = (() => {
  const m = new Map<string, 'basic' | 'equipment' | 'trick'>();
  const subOf = (t: CardType): 'basic' | 'equipment' | 'trick' =>
    t === '基本牌' ? 'basic' : t === '装备牌' ? 'equipment' : 'trick';
  for (const def of 基本牌列表) m.set(def.name, subOf(def.type));
  for (const def of 锦囊牌列表) m.set(def.name, subOf(def.type));
  for (const def of 装备牌列表) m.set(def.name, subOf(def.type));
  return m;
})();

/** 武将立绘 URL。name 为空返回 null。 */
export function getCharacterImage(name: string): string | null {
  if (!name) return null;
  return resourceManager.get(`character/${name}`);
}

/** 卡牌图 URL。需同时具备 name + suit + rank。 */
export function getCardImage(card: { name: string; suit?: string; rank?: string }): string | null {
  const sub = NAME_TO_SUB.get(card.name);
  if (!sub || !card.suit || !card.rank) return null;
  return resourceManager.get(`card/${card.name}-${card.rank}-${card.suit}`);
}

/** 装备区缩略图 URL。 */
export function getEquipCardImage(name: string): string | null {
  if (NAME_TO_SUB.get(name) !== 'equipment') return null;
  return resourceManager.get(`card/equipment/${name}`);
}
```

- [ ] **Step 4: 改 soundMap.ts 委托**

替换 `resolveSoundUrl` 函数实现（保留 SOUND_MAP 作为文档/参考，实际解析走 ResourceManager）：

```typescript
// src/client/sounds/soundMap.ts
// 音效标识符 → 资源 URL 解析。
// 现委托 ResourceManager（sound/{id} → ResourceManager.get('sound/' + id)）。
// SOUND_MAP 保留作为 soundId 语义对照文档（见文件头注释表格）。

import { resourceManager } from '../resources';

// （保留文件头原有的注释表格和 SOUND_MAP 常量，作为文档参考）

export const SOUND_MAP: Readonly<Record<string, string>> = {
  // （保持原有 31 项映射不变，仅作文档参考）
  play_card: '/sounds/play_card.mp3',
  // ... 其余保持不变
};

/** 根据 sound 标识符解析资源 URL。委托 ResourceManager。 */
export function resolveSoundUrl(soundId: string): string | null {
  return resourceManager.get(`sound/${soundId}`);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/client/resource-loading.test.tsx`
Expected: PASS（6 个测试）

- [ ] **Step 6: 跑全量回归**

Run: `npx vitest run`
Expected: 不引入新失败（已有 6 处消费点签名未变，行为兼容）

- [ ] **Step 7: Commit**

```bash
git add src/client/assets/imageAssets.ts src/client/sounds/soundMap.ts tests/client/resource-loading.test.tsx
git commit -m "feat(resources): Task 5 - imageAssets/soundMap 委托 ResourceManager"
```

---

## Task 6: 迁移脚本 (migrate-to-packs.ts)

**Files:**
- Create: `scripts/migrate-to-packs.ts`

**职责**：一次性把 `public/cards-local/` 和 `public/sounds/` 的现有文件搬到 `public/packs/base/`，并生成 `manifest.json`。

- [ ] **Step 1: 写脚本**

```typescript
// scripts/migrate-to-packs.ts
// 一次性迁移脚本：cards-local + sounds → packs/base + 生成 manifest.json。
//
// 用法：tsx scripts/migrate-to-packs.ts [--dry-run] [--copy]
//   --dry-run  只打印将做什么，不实际移动
//   --copy     复制而非移动（保留原文件）
//
// 迁移映射（见 spec §9）：
//   cards-local/basic/<名>-<点>-<花色>.{jpg,png}  → packs/base/card/<原文件名>
//   cards-local/equipment/<名>.png                 → packs/base/card/equipment/<名>.png
//   cards-local/trick/<名>-<点>-<花色>.png          → packs/base/card/<原文件名>
//   cards-local/characters/<名>.png                → packs/base/character/<名>.png
//   sounds/<id>.mp3                                → packs/base/sound/<id>.mp3
//
// manifest.json 生成规则：
//   - .jpg 文件：显式写 file（默认推断为 .png）
//   - .png/.mp3/.json：省略 file（按 ID 同构）

import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');
const OLD_CARD_LOCAL = join(PUBLIC, 'cards-local');
const OLD_SOUNDS = join(PUBLIC, 'sounds');
const NEW_BASE = join(PUBLIC, 'packs', 'base');

interface Move {
  from: string;
  to: string;
  resourceId: string;
  type: 'image' | 'audio';
  explicitFile?: string; // .jpg 需要显式
}

function scanMoves(): Move[] {
  const moves: Move[] = [];
  const sub = (name: string): 'basic' | 'equipment' | 'trick' | 'characters' | null => {
    if (['basic', 'equipment', 'trick', 'characters'].includes(name)) return name as any;
    return null;
  };

  if (existsSync(OLD_CARD_LOCAL)) {
    for (const dir of readdirSync(OLD_CARD_LOCAL, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const s = sub(dir.name);
      if (!s) continue;
      const srcDir = join(OLD_CARD_LOCAL, dir.name);
      for (const f of readdirSync(srcDir)) {
        const srcPath = join(srcDir, f);
        if (!statSync(srcPath).isFile()) continue;
        const ext = extname(f).toLowerCase();
        if (!['.png', '.jpg', '.jpeg'].includes(ext)) continue;
        const stem = basename(f, ext); // 杀-7-♠ / 曹操 / 丈八蛇矛
        if (s === 'characters') {
          moves.push({
            from: srcPath, to: join(NEW_BASE, 'character', `${stem}.png`),
            resourceId: `character/${stem}`, type: 'image',
          });
        } else if (s === 'equipment') {
          // 装备区分两套：缩略图 <名>.png 和手牌大图 <名>-<点>-<花色>.png
          if (f.includes('-')) {
            // 大图
            moves.push({
              from: srcPath, to: join(NEW_BASE, 'card', f),
              resourceId: `card/${stem}`, type: 'image',
              explicitFile: ext === '.jpg' ? `card/${f}` : undefined,
            });
          } else {
            // 缩略图
            moves.push({
              from: srcPath, to: join(NEW_BASE, 'card', 'equipment', f),
              resourceId: `card/equipment/${stem}`, type: 'image',
            });
          }
        } else {
          // basic / trick：都是 <名>-<点>-<花色>
          moves.push({
            from: srcPath, to: join(NEW_BASE, 'card', f),
            resourceId: `card/${stem}`, type: 'image',
            explicitFile: ext === '.jpg' ? `card/${f}` : undefined,
          });
        }
      }
    }
  }

  if (existsSync(OLD_SOUNDS)) {
    for (const f of readdirSync(OLD_SOUNDS)) {
      const srcPath = join(OLD_SOUNDS, f);
      if (!statSync(srcPath).isFile()) continue;
      const ext = extname(f).toLowerCase();
      if (ext !== '.mp3') continue;
      const stem = basename(f, ext);
      moves.push({
        from: srcPath, to: join(NEW_BASE, 'sound', f),
        resourceId: `sound/${stem}`, type: 'audio',
      });
    }
  }

  return moves;
}

function buildManifest(moves: Move[]) {
  const resources = moves.map((m) => {
    const entry: any = { id: m.resourceId, type: m.type };
    if (m.explicitFile) entry.file = m.explicitFile;
    return entry;
  });
  return {
    manifestVersion: 1 as const,
    id: 'base',
    name: '基础资源包',
    version: '1.0.0',
    author: '迁移自 cards-local + sounds',
    priority: 0,
    resources,
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const dry = args.has('--dry-run');
  const copy = args.has('--copy');

  const moves = scanMoves();
  if (moves.length === 0) {
    console.log('无可迁移文件（cards-local 和 sounds 均为空或不存在）。');
    return;
  }

  console.log(`将迁移 ${moves.length} 个文件到 ${NEW_BASE}：\n`);
  for (const m of moves) {
    console.log(`  ${m.from.replace(ROOT, '.')} → ${m.to.replace(ROOT, '.')}  [${m.resourceId}]`);
  }
  console.log('');

  if (dry) {
    console.log('[dry-run] 不实际移动。');
    return;
  }

  // 创建目标目录 + 移动/复制
  for (const m of moves) {
    mkdirSync(join(m.to, '..'), { recursive: true });
    if (copy) copyFileSync(m.from, m.to);
    else renameSync(m.from, m.to);
  }

  // 生成 manifest
  mkdirSync(NEW_BASE, { recursive: true });
  const manifest = buildManifest(moves);
  const manifestPath = join(NEW_BASE, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`已生成 ${manifestPath.replace(ROOT, '.')}（${manifest.resources.length} 项资源）`);
  console.log('\n完成。请启动 dev server 验证：curl http://localhost:3930/packs/index.json');
}

main();
```

- [ ] **Step 2: Dry-run 验证**

Run: `tsx scripts/migrate-to-packs.ts --dry-run`
Expected: 列出将迁移的文件（若 cards-local/sounds 为空则提示无可迁移，正常）

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-to-packs.ts
git commit -m "feat(scripts): Task 6 - 迁移脚本 cards-local+sounds → packs/base"
```

---

## Task 7: useResourcePacks hook + App 初始化

**Files:**
- Create: `src/client/hooks/useResourcePacks.ts`
- Modify: `src/client/App.tsx`（调用初始化）

**职责**：React hook 包装 ResourceManager，触发 `init()`、暴露包列表 state、提供 `togglePack`。

- [ ] **Step 1: 写 hook**

```typescript
// src/client/hooks/useResourcePacks.ts
// ResourceManager 的 React 包装。
// 触发 init()（fetch /packs/index.json + 读 localStorage + 合并），
// 暴露包列表 state（listPacks 快照）和 togglePack。

import { useState, useEffect, useCallback } from 'react';
import { resourceManager, type PackInfo } from '../resources';

export function useResourcePacks() {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resourceManager.init().then(() => {
      if (cancelled) return;
      setPacks(resourceManager.listPacks());
      setReady(true);
    }).catch(() => {
      // init 失败（fetch 异常）：静默，packs 保持空，资源走 fallback
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(() => {
    // 重新 fetch index.json（用户往 packs/ 丢新包后点）
    setReady(false);
    resourceManager.init().then(() => {
      setPacks(resourceManager.listPacks());
      setReady(true);
    });
  }, []);

  const togglePack = useCallback((packId: string, enabled: boolean) => {
    resourceManager.setPackEnabled(packId, enabled);
    setPacks(resourceManager.listPacks());
  }, []);

  return { packs, ready, refresh, togglePack };
}
```

注意 `resourceManager.init()` 是幂等的（已初始化时直接 return）。`refresh` 需要先 reset 才能重新 fetch——修正 `refresh` 实现：

```typescript
  const refresh = useCallback(() => {
    setReady(false);
    // reset 强制下次 init 重新 fetch
    resourceManager.reset();
    resourceManager.init().then(() => {
      setPacks(resourceManager.listPacks());
      setReady(true);
    });
  }, []);
```

- [ ] **Step 2: 接入 App.tsx**

读取 `src/client/App.tsx` 现有结构，找到组件顶部（通常有其他 hook 调用处）。加：

```typescript
import { useResourcePacks } from './hooks/useResourcePacks';

// 在 App 组件函数体顶部（与其他 hook 一起）：
function App() {
  // ... 现有 hooks
  useResourcePacks(); // 初始化 ResourceManager，触发 fetch /packs/index.json
  // ...
}
```

- [ ] **Step 3: 验证 tsc**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/client/hooks/useResourcePacks.ts src/client/App.tsx
git commit -m "feat(resources): Task 7 - useResourcePacks hook + App 初始化"
```

---

## Task 8: PackManagerPanel UI

**Files:**
- Create: `src/client/components/PackManagerPanel.tsx`
- Test: `tests/client/PackManagerPanel.test.tsx`

**职责**：列出所有已发现包，toggle 启停，刷新按钮。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/client/PackManagerPanel.test.tsx
// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackManagerPanel } from '../../src/client/components/PackManagerPanel';
import type { PackInfo } from '../../src/client/resources/types';

const makePack = (over: Partial<PackInfo> = {}): PackInfo => ({
  id: 'base', name: '基础资源包', version: '1.0.0', author: '内置',
  priority: 0, resourceCount: 10, enabled: true, ...over,
});

describe('PackManagerPanel', () => {
  it('渲染包列表', () => {
    const packs = [makePack(), makePack({ id: 'skin', name: '皮肤包', priority: 100, enabled: false })];
    render(<PackManagerPanel packs={packs} onToggle={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('基础资源包')).toBeInTheDocument();
    expect(screen.getByText('皮肤包')).toBeInTheDocument();
  });

  it('点击 checkbox 触发 onToggle', () => {
    const onToggle = vi.fn();
    const packs = [makePack()];
    render(<PackManagerPanel packs={packs} onToggle={onToggle} onRefresh={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: /基础资源包/ });
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith('base', false);
  });

  it('点击刷新按钮触发 onRefresh', () => {
    const onRefresh = vi.fn();
    render(<PackManagerPanel packs={[makePack()]} onToggle={vi.fn()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText('重新发现'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('显示 priority 和资源数', () => {
    render(<PackManagerPanel packs={[makePack({ priority: 100, resourceCount: 25 })]} onToggle={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText(/P100/)).toBeInTheDocument();
    expect(screen.getByText(/25项/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/client/PackManagerPanel.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 写组件实现**

```typescript
// src/client/components/PackManagerPanel.tsx
// 资源包管理面板：列出所有已发现包，toggle 启停，刷新发现。

import type { PackInfo } from '../resources/types';

export interface PackManagerPanelProps {
  packs: PackInfo[];
  onToggle: (packId: string, enabled: boolean) => void;
  onRefresh: () => void;
}

export function PackManagerPanel({ packs, onToggle, onRefresh }: PackManagerPanelProps) {
  return (
    <div style={{ padding: 16, background: '#1a1a2e', color: '#eee', borderRadius: 8, minWidth: 320 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>资源包管理</h3>
        <button onClick={onRefresh} style={btn}>重新发现</button>
      </div>
      {packs.length === 0 && <div style={{ opacity: 0.6 }}>未发现任何资源包</div>}
      {packs.map((p) => (
        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #333' }}>
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) => onToggle(p.id, e.target.checked)}
            aria-label={p.name}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              {p.name}
              <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 12 }}>P{p.priority} {p.resourceCount}项</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              作者:{p.author} v{p.version}
              {p.homepage && <> <a href={p.homepage} target="_blank" rel="noreferrer" style={{ color: '#6cf' }}>[来源]</a></>}
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '4px 10px', background: '#333', color: '#eee', border: '1px solid #555',
  borderRadius: 4, cursor: 'pointer',
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/client/PackManagerPanel.test.tsx`
Expected: PASS（4 个测试）

- [ ] **Step 5: 接入 GameView**

在 `src/client/components/GameView.tsx` 中找一个合适的设置入口位置（如右上角已有的 SoundControl 旁边），加：

```typescript
import { useResourcePacks } from '../hooks/useResourcePacks';
import { PackManagerPanel } from './PackManagerPanel';

// 在 GameView 组件中：
const { packs, ready, refresh, togglePack } = useResourcePacks();
const [showPacks, setShowPacks] = useState(false);

// JSX（放在 SoundControl 旁边）：
<button onClick={() => setShowPacks((v) => !v)} style={{ /* 与 SoundControl 同风格 */ }}>📦</button>
{showPacks && (
  <div style={{ position: 'absolute', top: 50, right: 8, zIndex: 1000 }}>
    <PackManagerPanel packs={packs} onToggle={togglePack} onRefresh={refresh} />
  </div>
)}
```

注意：GameView 中可能已有 useResourcePacks 调用（若 App 已初始化，此处只读 state）。若重复初始化，用 React Context 或提升到共同父组件。简化方案：直接在 GameView 调用（init 幂等）。

- [ ] **Step 6: 跑测试**

Run: `npx vitest run`
Expected: 无新失败

- [ ] **Step 7: Commit**

```bash
git add src/client/components/PackManagerPanel.tsx src/client/components/GameView.tsx tests/client/PackManagerPanel.test.tsx
git commit -m "feat(ui): Task 8 - PackManagerPanel 资源包管理 UI"
```

---

## Task 9: 系统动效 CSS (animations.css.ts)

**Files:**
- Create: `src/client/components/animations.css.ts`

**职责**：7 种系统动效的 CSS keyframes/类定义（flip/fade/shake/pulse/slide/highlight/flash），供 EventBanner 等组件消费。这是补全 spec §4.2 中"前端只实现 flip 一种"的悬空状态。

- [ ] **Step 1: 写 CSS 模块**

项目用 `@wyw-in-js/vite`（CSS in JS），参考现有 `gameViewStyles.ts` 的写法。先读取该文件确认风格：

Run: `head -50 src/client/components/gameViewStyles.ts`

然后写动画文件：

```typescript
// src/client/components/animations.css.ts
// 系统动效 CSS 类定义（effect.animation 字段消费）。
//
// 7 种内置动效，与引擎 AtomEffect.animation 字段约定的字符串一一对应：
//   flip / fade / shake / pulse / slide / highlight / flash
// 不可打包替换（属引擎固有 UI 反馈）。Lottie 特效（effect.vfx）才是可打包资源。

import { keyframes, css } from '@wyw-in-js/react';

export const flipKeyframes = keyframes`
  0% { transform: rotateY(0deg); }
  100% { transform: rotateY(180deg); }
`;

export const fadeKeyframes = keyframes`
  0% { opacity: 1; }
  100% { opacity: 0; }
`;

export const shakeKeyframes = keyframes`
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
`;

export const pulseKeyframes = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
`;

export const slideKeyframes = keyframes`
  0% { transform: translateY(-20px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
`;

export const highlightKeyframes = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 200, 0, 0); }
  50% { box-shadow: 0 0 12px 4px rgba(255, 200, 0, 0.7); }
`;

export const flashKeyframes = keyframes`
  0% { opacity: 0; }
  30% { opacity: 0.8; }
  100% { opacity: 0; }
`;

/** animation 名 → keyframes 映射 */
export const ANIMATION_KEYFRAMES: Record<string, ReturnType<typeof keyframes>> = {
  flip: flipKeyframes,
  fade: fadeKeyframes,
  shake: shakeKeyframes,
  pulse: pulseKeyframes,
  slide: slideKeyframes,
  highlight: highlightKeyframes,
  flash: flashKeyframes,
};

/** 生成动效 CSS 类。durationMs 为毫秒。 */
export function animationClass(name: string, durationMs: number): string | null {
  const kf = ANIMATION_KEYFRAMES[name];
  if (!kf) return null;
  // 返回内联样式字符串（wyw-in-js 的 css`` 会生成唯一类名）
  return css`
    animation: ${kf} ${durationMs}ms ease-in-out;
  `;
}
```

注意：`@wyw-in-js/react` 的具体导入路径需验证。若项目用其他 CSS-in-JS 方案，调整导入。读取现有组件确认：

Run: `grep -n "from '@wyw-in-js" src/client/components/gameViewStyles.ts`

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit src/client/components/animations.css.ts`
Expected: 无错误（或根据实际 CSS-in-JS 方案调整）

- [ ] **Step 3: Commit**

```bash
git add src/client/components/animations.css.ts
git commit -m "feat(ui): Task 9 - 7 种系统动效 CSS 定义"
```

---

## Task 10: Lottie 特效接入 (useVfxPlayback + VfxLayer)

**Files:**
- Create: `src/client/hooks/useVfxPlayback.ts`
- Create: `src/client/components/VfxLayer.tsx`
- Modify: `package.json`（加 lottie-web 依赖）

**职责**：监听 `useEventPlayback.ingested`，按 `effect.vfx` 查 ResourceManager 拿 Lottie JSON URL，在专用层播放一次。

- [ ] **Step 1: 安装 lottie-web**

```bash
pnpm add lottie-web
```

- [ ] **Step 2: 写 useVfxPlayback hook**

```typescript
// src/client/hooks/useVfxPlayback.ts
// Lottie 特效播放 hook：监听 useEventPlayback.ingested，按 effect.vfx 播放。
//
// 与 useSoundPlayback 同源（都挂 ingested，立即触发）。
// effect.vfx 是 Lottie 资源 ID（如 'skill_奸雄'），查 ResourceManager.get('anim/' + id)。
// 缺失资源静默跳过。

import { useEffect, useRef } from 'react';
import type { ViewEvent } from '../../engine/types';
import { getAtomDef } from '../../engine/atom';
import { resourceManager } from '../resources';
import type { QueuedEvent } from './useEventPlayback';

type EventEffect = { vfx?: string } | undefined;

function extractVfx(event: ViewEvent): string | null {
  const atomType = (event as { atomType?: string }).atomType ?? event.type;
  let staticEffect: EventEffect;
  try {
    staticEffect = getAtomDef(atomType).effect as EventEffect;
  } catch {
    staticEffect = undefined;
  }
  const effect = (event.effect as EventEffect) ?? staticEffect;
  return effect?.vfx ?? null;
}

export interface VfxPlaybackItem {
  /** 唯一 key（seq + vfxId），供 React 列表渲染 */
  key: string;
  /** Lottie JSON URL */
  url: string;
}

export function useVfxPlayback(ingested: readonly QueuedEvent[] | null | undefined): VfxPlaybackItem[] {
  const lastSeqRef = useRef(0);
  // 用 ref 累积待播项目，触发 state 更新
  const queueRef = useRef<VfxPlaybackItem[]>([]);

  useEffect(() => {
    if (!ingested || ingested.length === 0) return;
    const fresh = ingested.filter((e) => e.seq > lastSeqRef.current);
    if (fresh.length === 0) return;
    lastSeqRef.current = Math.max(...fresh.map((e) => e.seq));

    const newItems: VfxPlaybackItem[] = [];
    for (const { event, seq } of fresh) {
      const vfxId = extractVfx(event);
      if (!vfxId) continue;
      const url = resourceManager.get(`anim/${vfxId}`);
      if (!url) continue;
      newItems.push({ key: `${seq}-${vfxId}`, url });
    }
    if (newItems.length > 0) {
      queueRef.current = [...queueRef.current, ...newItems];
    }
  }, [ingested]);

  return queueRef.current;
}
```

- [ ] **Step 3: 写 VfxLayer 组件**

```typescript
// src/client/components/VfxLayer.tsx
// Lottie 特效渲染层。独立 z-index，pointer-events:none。
//
// 接收 useVfxPlayback 返回的项目列表，每个项目挂一个 <Lottie> 播放一次后自移除。

import { useEffect, useState } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';
import type { VfxPlaybackItem } from '../hooks/useVfxPlayback';

interface ActiveVfx extends VfxPlaybackItem {
  startedAt: number;
}

export function VfxLayer({ items }: { items: VfxPlaybackItem[] }) {
  const [active, setActive] = useState<ActiveVfx[]>([]);

  useEffect(() => {
    if (items.length === 0) return;
    const now = Date.now();
    setActive((prev) => [...prev, ...items.map((i) => ({ ...i, startedAt: now }))]);
  }, [items]);

  // 每个项目播放 2s 后自动清除（Lottie 通常 1-2s）
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setTimeout(() => {
      setActive((prev) => prev.filter((a) => Date.now() - a.startedAt < 2000));
    }, 2100);
    return () => clearTimeout(timer);
  }, [active]);

  return (
    <div style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {active.map((v) => (
        <LottiePlayer key={v.key} url={v.url} />
      ))}
    </div>
  );
}

function LottiePlayer({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    let anim: AnimationItem | undefined;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!ref.current) return;
        anim = lottie.loadAnimation({
          container: ref.current, renderer: 'svg', loop: false, autoplay: true,
          animationData: data,
        });
      })
      .catch(() => { /* 缺失/损坏静默 */ });
    return () => { anim?.destroy(); };
  }, [url]);
  return <div ref={ref} style={{ width: 400, height: 400 }} />;
}
```

注意：`VfxLayer` 用了 `useRef`，需在文件顶部加 `import { useEffect, useRef, useState } from 'react';`。

- [ ] **Step 4: 接入 GameView**

在 GameView 中（与 useSoundPlayback 同位置）：

```typescript
import { useVfxPlayback } from '../hooks/useVfxPlayback';
import { VfxLayer } from './VfxLayer';

const vfxItems = useVfxPlayback(ingestedEvents); // ingestedEvents 来自 useEventPlayback

// JSX 末尾：
<VfxLayer items={vfxItems} />
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 6: Commit**

```bash
git add src/client/hooks/useVfxPlayback.ts src/client/components/VfxLayer.tsx src/client/components/GameView.tsx package.json pnpm-lock.yaml
git commit -m "feat(vfx): Task 10 - Lottie 特效接入 (useVfxPlayback + VfxLayer)"
```

---

## Task 11: EventBanner 整合系统动效

**Files:**
- Modify: `src/client/components/EventBanner.tsx`

**职责**：EventBanner 当前只处理 `flip`，扩展为消费 `animationClass(animation, duration)` 应用动效类。本 task 把现有 flip 逻辑保留，新增其他动效的类应用（不破坏现有翻牌行为）。

- [ ] **Step 1: 读取现有 EventBanner 结构**

Run: `cat src/client/components/EventBanner.tsx`
理解现有 `effect.animation === 'flip'` 分支。

- [ ] **Step 2: 扩展动效支持**

修改 EventBanner，在 flip 分支外，对其他 animation 名应用 `animationClass`。核心改动：现有 `if (effect?.animation !== 'flip') return null;` 改为支持多动效的分支结构。

具体改动需根据现有结构，原则：
- flip 保持现有 3D 翻牌逻辑（复杂，不重构）
- fade/shake/pulse/slide/highlight/flash：用 `animationClass(name, effect.duration ?? 400)` 应用到中央浮动卡牌的容器

```typescript
// 伪代码示例（实际需嵌入现有结构）：
import { animationClass } from './animations.css';

const animName = effect?.animation;
if (animName === 'flip') {
  // 现有 flip 逻辑不动
} else if (animName) {
  const cls = animationClass(animName, effect?.duration ?? 400);
  if (cls) {
    // 应用 cls 到浮动层容器
  }
}
```

- [ ] **Step 3: 跑回归测试**

Run: `npx vitest run`
Expected: 无新失败（EventBanner 行为扩展，不破坏现有）

- [ ] **Step 4: Commit**

```bash
git add src/client/components/EventBanner.tsx
git commit -m "feat(ui): Task 11 - EventBanner 整合 7 种系统动效"
```

---

## Task 12: gen-card.ts --install 选项

**Files:**
- Modify: `scripts/gen-card.ts`

**职责**：加 `--install` 选项，产出直接进 `public/packs/base/card/` 并更新 `packs/base/manifest.json`。

- [ ] **Step 1: 读取 gen-card.ts 产出逻辑**

Run: `grep -n "AI_DIR\|outFile\|outDir\|outName" scripts/gen-card.ts`

确认 `AI_DIR`（约第 134 行）和 `outFile`（约第 749 行）。

- [ ] **Step 2: 加 --install 参数解析**

在参数解析段（约 `const args = ...`）加：

```typescript
const installMode = args['install'] === true;
const INSTALL_DIR = join(ROOT, 'public', 'packs', 'base', 'card');
```

修改产出目录选择逻辑：

```typescript
const targetDir = installMode ? INSTALL_DIR : outDir;
const outFile = outNameArg
  ? join(targetDir, outNameArg)
  : join(targetDir, `${name}${suffix}.png`);
```

- [ ] **Step 3: --install 时更新 manifest.json**

在产出成功后（`console.log('已合成成品...')` 之后）加：

```typescript
if (installMode) {
  const manifestPath = join(ROOT, 'public', 'packs', 'base', 'manifest.json');
  let manifest: any = { manifestVersion: 1, id: 'base', name: '基础资源包', version: '1.0.0', author: 'gen-card', priority: 0, resources: [] };
  if (existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')); } catch {}
  }
  const newId = `card/${basename(outFile, '.png')}`;
  const exists = manifest.resources.find((r: any) => r.id === newId);
  if (!exists) {
    manifest.resources.push({ id: newId, type: 'image', file: `card/${basename(outFile)}` });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`已更新 manifest.json（+1 资源）`);
  }
}
```

需在文件顶部加 `readFileSync, writeFileSync` 到 fs import。

- [ ] **Step 4: 更新文件头注释**

在 gen-card.ts 文件头用法说明加 `--install`：

```typescript
//   --install       成品直接产出到 public/packs/base/card/ 并更新 manifest.json
```

- [ ] **Step 5: Smoke 验证（dry-run）**

Run: `tsx scripts/gen-card.ts 杀 --suit ♠ --rank 7 --dry-run --install`
Expected: dry-run 打印，无崩溃（不实际产出）

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-card.ts
git commit -m "feat(scripts): Task 12 - gen-card --install 直接进 packs/base"
```

---

## Task 13: 端到端验证 + 文档

**Files:**
- Update: `public/sounds/README.md` → `public/packs/base/README.md`（或新建 spec 文档补充）
- No new code,纯验证

- [ ] **Step 1: 跑迁移脚本**

Run: `tsx scripts/migrate-to-packs.ts --copy`
Expected: 把现有 cards-local 和 sounds 复制到 packs/base（保留原文件）

- [ ] **Step 2: 验证 index.json 生成**

Run: `npm run dev &` → `curl -s http://localhost:3930/packs/index.json | head`
Expected: 返回 `{"packs":[{"id":"base","manifest":{...}}]}`

- [ ] **Step 3: 浏览器 smoke**

打开 `http://localhost:3930`，进入游戏：
- 图片正常显示（武将立绘、卡牌图）
- 音效正常播放（出牌、翻牌等）
- SoundControl 静音/音量工作
- 📦 按钮点开 PackManagerPanel，显示 base 包，可 toggle

- [ ] **Step 4: 测试覆盖性包（模拟第三方）**

手动创建测试包：

```bash
mkdir -p public/packs/test-skin/character
# 复制一个不同的图到 test-skin/character/曹操.png
cat > public/packs/test-skin/manifest.json << 'EOF'
{
  "manifestVersion": 1, "id": "test-skin", "name": "测试皮肤包", "version": "1.0.0",
  "author": "test", "priority": 100,
  "resources": [{ "id": "character/曹操", "type": "image" }]
}
EOF
```

刷新页面 → PackManagerPanel 显示 test-skin → 启用它 → 曹操立绘变成 test-skin 的图。

- [ ] **Step 5: 跑全量测试**

Run: `npx vitest run`
Expected: 不引入新失败（pre-existing 失败除外）

- [ ] **Step 6: tsc 最终检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 7: 写资源规范 README**

在 `docs/` 下新建资源规范文档（基于 spec），供第三方打包者参考：

```bash
# 内容直接复用 spec 的 §3-7 章节，整理为面向打包者的指南
```

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "feat(resources): Task 13 - 端到端验证 + 资源规范文档"
```

---

## 完成后回顾

实现完所有 task 后，对照 spec §13 验收标准逐项确认：

- [ ] 现有图片/音频加载全部回归通过
- [ ] ResourceManager.get 对所有已迁移资源 ID 返回正确 URL
- [ ] 放入测试包（高 priority 同 ID 覆盖 base），覆盖生效
- [ ] PackManagerPanel toggle 启停某包，资源即时切换
- [ ] 缺失资源所有 fallback 正常触发
- [ ] tsc --noEmit 无新增错误
- [ ] vitest run 不引入新失败
- [ ] npm run dev 起得来，smoke 验证三种模式资源加载正常
