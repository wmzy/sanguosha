// src/client/hooks/useAutoSkipPrefs.ts
// 自动跳过偏好 hook:持久化用户「代我跳过此类询问」的选择到 localStorage。
//
// localStorage key: `sgs:auto-skip`
//   存储格式:JSON `{ optInSkip: { '无懈可击': true, ... } }`
//
// 与 useSoundSettings 同构:首次挂载读 localStorage,变更时写回。
// 多组件实例各自持有独立 state,但读写同一个 key + 通过 storage 事件跨 tab 同步。

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFS, type AutoSkipPrefs } from '../utils/autoSkip';

/** localStorage 持久化 key */
const STORAGE_KEY = 'sgs:auto-skip';

/** 从 localStorage 读取偏好;解析失败/不可用时回退默认值 */
function loadPrefs(): AutoSkipPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AutoSkipPrefs>;
    const optIn = parsed.optInSkip;
    return {
      optInSkip:
        optIn && typeof optIn === 'object' ? { ...optIn } : {},
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 持久化偏好到 localStorage;失败静默 */
function savePrefs(prefs: AutoSkipPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage 不可用时静默(隐私模式/配额满) */
  }
}

export interface UseAutoSkipPrefs {
  prefs: AutoSkipPrefs;
  /** 切换某个 requestType 的策略跳过开关 */
  toggleOptIn: (requestType: string) => void;
  /** 查询某个 requestType 是否已开启策略跳过 */
  isOptedIn: (requestType: string) => boolean;
}

/**
 * 自动跳过偏好 hook。
 *
 * 首次挂载时从 localStorage 读取。toggleOptIn 切换指定 requestType 的开关并持久化。
 *
 * @returns { prefs, toggleOptIn, isOptedIn }
 */
export function useAutoSkipPrefs(): UseAutoSkipPrefs {
  const [prefs, setPrefs] = useState<AutoSkipPrefs>(() => loadPrefs());

  // 跨 tab 同步:storage 事件
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefs(loadPrefs());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleOptIn = useCallback((requestType: string) => {
    setPrefs((prev) => {
      const next: AutoSkipPrefs = {
        optInSkip: { ...prev.optInSkip, [requestType]: !prev.optInSkip[requestType] },
      };
      savePrefs(next);
      return next;
    });
  }, []);

  const isOptedIn = useCallback(
    (requestType: string) => !!prefs.optInSkip[requestType],
    [prefs],
  );

  return { prefs, toggleOptIn, isOptedIn };
}
