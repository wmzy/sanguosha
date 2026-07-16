// 订阅技能模块缓存(moduleCache)的变更通知。
//
// 问题:getSkillDescription 依赖 moduleCache(由 useSkillActions 异步 effect 填充)。
// 首次渲染时 moduleCache 为空 → getSkillDescription 返回 undefined → title 为空。
// effect 完成后 moduleCache 被填充,但组件的 React.memo 可能在 player 引用不变时
// 跳过重渲染(如 PlayerSeatView),导致 title 永远是 undefined。
//
// 解法:用 useSyncExternalStore 订阅 moduleCacheVersion。当新模块被加载时,
// 所有调用此 hook 的组件都会重渲染,使 getSkillDescription 在二次渲染时命中缓存。
// useSyncExternalStore 触发的重渲染不受 React.memo 阻止(memo 只拦截 props 变化)。

import { useSyncExternalStore } from 'react';
import { subscribeModuleCache, getModuleCacheVersion } from '../../engine/skill';

export function useSkillDescReady(): void {
  useSyncExternalStore(subscribeModuleCache, getModuleCacheVersion);
}
