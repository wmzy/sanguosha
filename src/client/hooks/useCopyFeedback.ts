// src/client/hooks/useCopyFeedback.ts
// 「复制到剪贴板 + 已复制反馈」共享 hook:原先在 WaitingStage(房间码/邀请链接/旁观链接
// 三按钮)与 DebugPerspectiveBar(快照路径)各手抄一份(copied 状态 + 2s 回退 + 卸载清理)。
// - copy(text, key):走 utils/clipboard 的安全 fallback 复制;成功后 copiedKey 置为 key,
//   2 秒后自动回退 null;连续触发时清除旧计时器,后点的反馈覆盖先点的;
// - 卸载时清理计时器,避免对已卸载组件 setState;
// - 复制失败静默返回 false(两条复制路径都失败时无可靠反馈手段,不弹错打扰用户)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../utils/clipboard';

/** 单按钮场景的缺省反馈 key(调用方不传 key 时 copiedKey 收敛为它,用 !== null 判断) */
const DEFAULT_KEY = 'default';

/** 复制反馈 hook:copiedKey 为当前处于「已复制」态的反馈 key(2 秒后回退 null)。 */
export function useCopyFeedback(): {
  copiedKey: string | null;
  /** 复制文本并启动反馈计时;返回复制是否成功 */
  copy: (text: string, key?: string) => Promise<boolean>;
} {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载清理计时器,避免对已卸载组件 setState
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(async (text: string, key: string = DEFAULT_KEY) => {
    const ok = await copyToClipboard(text);
    if (!ok) return false;
    setCopiedKey(key);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedKey(null), 2000);
    return true;
  }, []);

  return { copiedKey, copy };
}
