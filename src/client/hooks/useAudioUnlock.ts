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
 * 解锁后预加载的高频音效。这些音效在游戏中触发最频繁、对延迟最敏感(摸牌每回合多次、
 * 出杀/闪避为最常见攻防),预加载消除首次播放的 fetch+解码延迟。fire-and-forget,不阻塞首帧。
 */
const PRELOAD_SOUNDS = [
  'flip', // 摸牌/弃牌/获得/判定(最高频)
  'card/杀', // 出杀(最常见攻击)
  'card/闪', // 闪避(最常见响应)
  'card/桃', // 桃(回复/救人)
  'card/无中生有', // 常见摸牌锦囊
  'heal', // 回复体力
] as const;

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
      // 预热高频音效:首次摸牌/出杀等无延迟(文件缺失会静默负缓存,无副作用)
      audioEngine.preload(PRELOAD_SOUNDS);
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
