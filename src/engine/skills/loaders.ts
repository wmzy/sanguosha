// src/engine/skills/loaders.ts — 按 moduleSpec 动态加载技能模块(双环境)。
//
// 两个运行时,同一套 spec 解析:
//   Vite(vitest/浏览器): import.meta.glob 静态展开为 路径→loader 映射(vite-glob.ts),
//                        构建期可分析,浏览器按需加载懒 chunk。
//   Node(tsx server / MCP): vite-glob 模块求值失败(import.meta.glob 不存在),
//                        回退为按文件绝对路径的动态 import(ESM 模块缓存)。
//
// spec 语法见 registry.ts 文件头。'#导出名' 后缀用于多技能共享模块(马匹技能)。

import type { SkillModule } from '../types';
import { getSkillModuleSpec } from './registry';

type GlobLoaders = Record<string, () => Promise<Record<string, unknown>>>;

/** spec 'skills/cards/use-card' → vite-glob key './cards/use-card.ts' */
function globKeyOf(spec: string): string {
  const filePath = spec.slice('skills/'.length);
  return `./${filePath}.ts`;
}

async function importModuleFile(spec: string): Promise<Record<string, unknown>> {
  // 分支一:Vite/vitest。import('./vite-glob') 在 Node 下模块求值抛 TypeError → 走分支二。
  let glob: GlobLoaders | undefined;
  try {
    glob = (await import('./vite-glob')).default as GlobLoaders;
  } catch {
    glob = undefined;
  }
  if (glob) {
    const loader = glob[globKeyOf(spec)];
    if (!loader) {
      throw new Error(`技能模块 ${spec} 不在 vite-glob 映射中(文件缺失?)`);
    }
    return loader();
  }

  // 分支二:Node。用变量形式的动态 import 绕开打包器对 node: 内置模块的静态分析
  // (浏览器 bundle 永远走不到这里)。
  const urlSpec = 'node:url';
  const pathSpec = 'node:path';
  const { fileURLToPath, pathToFileURL } = (await import(/* @vite-ignore */ urlSpec)) as typeof import('node:url');
  const { resolve } = (await import(/* @vite-ignore */ pathSpec)) as typeof import('node:path');
  // loaders.ts 位于 src/engine/skills/ → 引擎根(src/engine/)为其上一级
  const engineRoot = fileURLToPath(new URL('../', import.meta.url));
  const file = resolve(engineRoot, `${spec}.ts`);
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<Record<string, unknown>>;
}

/**
 * 按 skillId 加载技能模块。未声明的 id 抛错(调用方需先用 hasSkillModule 过滤)。
 * 模块形状(存在 createSkill 函数 / '#导出名' 命中)在此校验,坏声明立即暴露。
 */
export async function importSkillModuleById(id: string): Promise<SkillModule> {
  const spec = getSkillModuleSpec(id);
  if (!spec) throw new Error(`技能 "${id}" 无模块声明(registry 聚合结果中不存在)`);
  const [filePath, exportName] = spec.split('#');
  const mod = await importModuleFile(filePath);
  const target = exportName ? mod[exportName] : mod;
  if (!target || typeof (target as SkillModule).createSkill !== 'function') {
    throw new Error(
      `技能模块 ${spec} 形状不符:期望${exportName ? `导出 "${exportName}" 且` : ''}含 createSkill 函数`,
    );
  }
  return target as SkillModule;
}
