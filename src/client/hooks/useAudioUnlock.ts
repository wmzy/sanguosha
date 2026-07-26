// src/client/hooks/useAudioUnlock.ts
// 自动播放策略解锁 hook:在 App 根挂载一次性 click/keydown listener,
// 首次用户交互后创建并 resume AudioContext。
//
// 浏览器自动播放策略(Autoplay Policy):AudioContext 在用户交互前处于 suspended,
// 无法发声。本 hook 注册一次性监听器,任意 click/keydown/touchstart 触发后
// 调用 audioEngine.unlock() 创建 context,然后移除监听器(不重复触发)。
//
// 使用:在 App 根组件调用 `useAudioUnlock()`(仅需一处)。

import { useEffect } from 'react';
import { audioEngine } from '../sounds/audioEngine';

/** 触发解锁的事件类型(覆盖鼠标/键盘/触摸) */
const UNLOCK_EVENTS: Array<keyof DocumentEventMap> = ['click', 'keydown', 'touchstart'];

/**
 * 注册一次性自动播放解锁监听器。
 * 应在应用最顶层(App)调用,确保全局只注册一次。
 */
export function useAudioUnlock(): void {
  useEffect(() => {
    // 已经解锁(如 SSR hydration 后已有交互):无需注册
    if (audioEngine.isUnlocked()) return;

    let unlocked = false;
    const handler = () => {
      if (unlocked) return;
      unlocked = true;
      audioEngine.unlock();
      // 解锁后移除所有监听器(一次性)
      for (const evt of UNLOCK_EVENTS) {
        document.removeEventListener(evt, handler, true);
      }
    };

    // capture: true 确保在目标元素之前捕获,尽早解锁
    for (const evt of UNLOCK_EVENTS) {
      document.addEventListener(evt, handler, true);
    }

    return () => {
      for (const evt of UNLOCK_EVENTS) {
        document.removeEventListener(evt, handler, true);
      }
    };
  }, []);
}
