// src/client/hooks/useResourcePacks.ts
// ResourceManager 的 React 包装。
// 触发 init()（fetch /packs/index.json + 读 localStorage + 合并），
// 暴露包列表 state（listPacks 快照）和 togglePack。

import { useState, useEffect, useCallback } from 'react';
import { resourceManager, type PackInfo } from '../resources';

export function useResourcePacks() {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resourceManager.init().then(() => {
      if (cancelled) return;
      setPacks(resourceManager.listPacks());
      setReady(true);
    }).catch(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(() => {
    setReady(false);
    // reset 强制下次 init 重新 fetch
    resourceManager.reset();
    resourceManager.init().then(() => {
      setPacks(resourceManager.listPacks());
      setReady(true);
    });
  }, []);

  const togglePack = useCallback((packId: string, enabled: boolean) => {
    resourceManager.setPackEnabled(packId, enabled);
    setPacks(resourceManager.listPacks());
  }, []);

  return { packs, ready, refresh, togglePack };
}
