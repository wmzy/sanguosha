// src/engine/skills/vite-glob.ts — Vite/vitest 环境的技能模块静态映射。
//
// Vite 构建时把 import.meta.glob 字面调用展开为 { 路径 → () => import(路径) } 映射,
// 每个技能模块成为懒 chunk(与旧手写 loader 表等价的按需加载)。
// 排除注册表自身的支撑文件,避免自引用。
//
// 注意:Node(tsx)下 import 本模块会在求值时抛 TypeError(import.meta.glob 不是函数),
// 由 loaders.ts 捕获并走 Node 动态 import 分支 —— 本文件必须保持独立、无其他副作用。

export default import.meta.glob([
  './**/*.ts',
  '!./index.ts',
  '!./registry.ts',
  '!./loaders.ts',
  '!./lifecycle.ts',
  '!./vite-glob.ts',
]);
