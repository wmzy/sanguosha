// tests/scenarios/装备/丈八蛇矛.test.ts — 丈八蛇矛 v3 钩子测试
//
// §4.3 修：v3 hook 骨架就位（engine/skills/zhangba.ts）。
// 完整多步 prompt（选 2 张手牌当【杀】）留 P2 完整化。
// 当前占位：filter 仅在 source 装备 zhangba && card.name === 杀 && hand>=2 时匹配，
// onBefore 不过滤、不取消。
//
// 完整测试留 P2 后追加；本文件保留 as it.skip skeleton。

import { describe, it } from 'vitest';

describe('丈八蛇矛 v3（两张手牌当【杀】）', () => {
  // TODO(P2): 完整化 multiStep prompt 选 2 张手牌当【杀】后追加 it 用例：
  // - 手牌 >= 2 张时 prompt 选 2 张，弃牌 + 生成 useCard
  // - 手牌 < 2 张时禁用此路径
  // - 不装备 zhangba 时 hook 不触发
  it.skip('待 P2 完整化：选 2 张手牌当【杀】', () => {
    // P2 完整化后实现
  });
});
