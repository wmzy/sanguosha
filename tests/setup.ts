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
});
