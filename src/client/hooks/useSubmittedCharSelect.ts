// 已提交选将的消费 hooks + Context。从 SubmittedCharSelectCtx 提取，
// 避免 react-refresh/only-export-components 警告（组件文件只导出组件）。

import { createContext, useContext } from 'react';

export interface SubmittedCharSelectCtl {
  submitted: Set<number>;
  markSubmitted: (target: number) => void;
  clearAll: () => void;
}

export const Ctx = createContext<SubmittedCharSelectCtl>({
  submitted: new Set(),
  markSubmitted: () => {},
  clearAll: () => {},
});

export function useSubmittedCharSelects(): Set<number> {
  return useContext(Ctx).submitted;
}

export function useMarkCharSelectSubmitted(): (target: number) => void {
  return useContext(Ctx).markSubmitted;
}

export function useClearSubmittedCharSelects(): () => void {
  return useContext(Ctx).clearAll;
}
