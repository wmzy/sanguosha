// types/index.ts — barrel 统一导出。
// 原 src/engine/types.ts 按域拆分为 state/prompt/atom/view/skill 五个文件,
// 本 barrel 聚合全部导出,保持外部 `from '../engine/types'` / `from '../../engine/types'` 路径不变。
// 运行时导出仅有 state.ts 的 TARGET_SYSTEM / TARGET_BROADCAST / createGameState,
// 其余均为类型(`import type` 跨文件引用,编译期擦除,无运行时循环依赖)。

export * from './state';
export * from './prompt';
export * from './atom';
export * from './view';
export * from './skill';
