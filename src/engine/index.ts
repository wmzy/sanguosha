// src/engine/index.ts — 引擎对外唯一入口(纯门面 re-export)。
// session 层通过此文件访问引擎 API:import { create } from './engine'。
// 内部消费者不应从此文件 import —— 直接使用 core/ 子模块。
export {
  create,
  bootstrap,
  dispatch,
  restore,
  registerSkillsFromState,
  buildView,
  fireTimeout,
  checkGameOver,
} from './core';
export type { GameConfig } from './core';
