// src/client/resources/types.ts
// 资源包系统类型定义。
// 详见 docs/superpowers/specs/2026-07-26-resource-pack-system-design.md

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
