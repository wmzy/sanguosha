// src/client/hooks/SubmittedCharSelectCtx.ts
// 跨 hook 共享:已提交选将的座次集合。
// DebugLobby 的 useDebugMultiConnection 提供(通过 Context.Provider),
// useCharSelect 消费(通过 useContext)。
// DebugLobby 只需包一层 Provider,不需要知道 GameView 具体信息。

import { useState, useCallback, type ReactNode } from 'react';
import { Ctx } from './useSubmittedCharSelect';

export function SubmittedCharSelectProvider({ children }: { children: ReactNode }) {
  const [submitted, setSubmitted] = useState(() => new Set<number>());
  const markSubmitted = useCallback((target: number) => {
    setSubmitted((prev) => {
      if (prev.has(target)) return prev;
      const next = new Set(prev);
      next.add(target);
      return next;
    });
  }, []);
  const clearAll = useCallback(() => setSubmitted(new Set()), []);
  return <Ctx.Provider value={{ submitted, markSubmitted, clearAll }}>{children}</Ctx.Provider>;
}


