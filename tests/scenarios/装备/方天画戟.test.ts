// tests/scenarios/装备/方天画戟.test.ts — 方天画戟 v3 钩子测试
//
// §4.3 修：v3 hook 骨架就位（engine/skills/fangtian.ts）。
// 完整多目标 prompt（选 1-2 个追加目标）留 P2 完整化。
// 当前占位：filter 仅在 source 装备 fangtian && source.hand === 0 时匹配，
// onAfter 不追加任何目标。
//
// 完整测试留 P2 后追加；本文件保留 as it.skip skeleton。

import { describe, it } from 'vitest';

describe('方天画戟 v3（手牌为 0 时多目标【杀】）', () => {
  // TODO(P2): 完整化 multiStep prompt 选 1-2 个追加目标后追加 it 用例：
  // - 手牌为 0 时可选最多 2 个追加目标（合计 3 个）
  // - 手牌 > 0 时 hook 不触发
  // - 不装备 fangtian 时 hook 不触发
  it.skip('待 P2 完整化：手牌为 0 时多目标【杀】', () => {
    // P2 完整化后实现
  });
});
