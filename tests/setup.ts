import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 全局注册 cleanup:每个测试结束后卸载所有通过 render() 挂载的 React 组件。
// @testing-library/react 默认在模块加载时自动注册 afterEach(cleanup),
// 但 isolate:false 下模块只加载一次(第一个 import 它的文件),后续文件不再注册,
// 导致前一个文件的 DOM 残留污染当前文件的 screen 查询。
// 在全局 setup 中显式注册,保证所有测试文件都有 cleanup 钩子。
// node 环境下 mountedContainers 为空,cleanup 是 no-op,安全。
afterEach(() => {
  cleanup();
  // 清理由 cardFlyAnimation/cardMoveAnimation 直接 document.body.appendChild 的瞬时
  // 飞牌动画元素。这些元素不走 React,@testing-library 的 cleanup 不会管理它们;
  // jsdom 不触发 CSS animation 的 animationend,即便有 setTimeout 兜底也存在
  // ~1.2s 窗口。isolate:false 下它们会跨文件残留到 document.body,污染后续测试的
  // screen.queryByText 查询(如 replay-equip-ui-repro 的装备文本断言)。
  // 用 data-fly-card 标记精确定位并移除,避免误删 React 容器。
  if (typeof document !== 'undefined' && document.body) {
    document.body.querySelectorAll('[data-fly-card]').forEach((el) => el.remove());
  }
});
