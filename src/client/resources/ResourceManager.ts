// src/client/resources/ResourceManager.ts
// 资源包管理单例：合并多包 manifest，按全局资源 ID 返回 URL。

import type {
  PacksIndex,
  Manifest,
  PackInfo,
  PackSettings,
  ResolvedResource,
  ResourceEntry,
} from './types';
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
        id: m.id,
        name: m.name,
        version: m.version,
        author: m.author,
        description: m.description,
        homepage: m.homepage,
        priority: m.priority,
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
    } catch {
      /* 损坏数据忽略 */
    }
    enabled ??= [BASE_PACK_ID]; // 首次默认启 base
    this.enabledSet = new Set((enabled ?? []).filter((id) => this.packs.has(id)));
    this.persistSettings();
  }

  private persistSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: [...this.enabledSet] }));
    } catch {
      /* 无 localStorage 环境（测试）静默 */
    }
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
