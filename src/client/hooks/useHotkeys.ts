// src/client/hooks/useHotkeys.ts
// 通用键盘快捷键 hook:全局 keydown → handlers 映射。
//
// 设计取舍:
// - handlers 用 ref 存最新引用、listener 只挂一次:
//   调用方(GameView)每次渲染都会重建 handlers 闭包(捕获最新交互状态),
//   若把 handlers 放进 effect deps 会导致每次渲染解绑/重挂 window 监听,
//   既浪费又可能在快速按键间隙丢事件。ref 方案让 listener 生命周期与组件一致。
// - key 统一小写化:Enter/Escape/Space 的 e.key 为 'Enter'/'Escape'/' '(),
//   空格特判为 'space',其余 toLowerCase,调用方按 'enter'/'escape'/'space'/'e'/'1' 写。
// - 表单元素内不触发:聊天输入框打字时快捷键必须完全静默(input/textarea/select/
//   contentEditable 一律忽略),否则按 1-9 选牌会和输入冲突。
// - 修饰键组合不劫持:meta/ctrl/alt 按下时直接忽略,把 Cmd/Ctrl 系浏览器快捷键
//   (Cmd+E、Ctrl+1 切 tab 等)留给浏览器,游戏快捷键只响应裸按键。

import { useEffect, useRef } from 'react';

/** 快捷键表:key 为小写键名,值为按下时的回调 */
export type HotkeyHandlers = Record<string, (e: KeyboardEvent) => void>;

/** e.key → 归一化小写键名(空格 ' ' 特判为 'space') */
function normalizeKey(key: string): string {
  return key === ' ' ? 'space' : key.toLowerCase();
}

/** 事件源头是可编辑元素时不响应快捷键(打字优先) */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

export function useHotkeys(handlers: HotkeyHandlers): void {
  // ref 始终指向最新一次渲染的 handlers,listener 读取 ref 而非闭包捕获
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 不劫持浏览器/系统快捷键(Cmd/Ctrl/Alt 组合)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 输入框等可编辑元素内打字时静默
      if (isEditableTarget(e.target)) return;
      const handler = handlersRef.current[normalizeKey(e.key)];
      handler?.(e);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
