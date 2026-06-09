// engine/skills/崩坏.async.ts — 崩坏（董卓）AsyncHook PoC
//
// 验证 [P5-T2 ADR 0025] async hook 设计端到端可用：
// - 监听 阶段结束 atom
// - onAfter 检查体力最低
// - 体力非最低 → await pending(选项: 减体力/减体力上限)
// - 按玩家响应 apply 原子
//
// 跟 v2 兜底并存（src/engine/skills/崩坏.ts 仍导出 v2 SkillDef）。
// 本文件导出 AsyncHook 对象，供 PoC 测试 register + applyAtomsAsync 验证。

import type { AsyncHook } from '../async-hook';
import type { GameState, Atom, Json } from '../types';

export const bengHuaiAsyncHook: AsyncHook = {
  id: 'benghuai-async',
  description: '董卓 - 崩坏（async hook PoC）',
  atomType: '阶段结束',
  // 动态启用：仅董卓回合结束 + 体力非全场最少时触发
  filter: (state: GameState, atom: Atom) => {
    if ((atom as Atom & { type: '阶段结束' }).phase !== '结束') return false;
    const player = (atom as Atom & { type: '阶段结束' }).player as string;
    if (state.players[player]?.info.characterId !== '董卓') return false;
    // 体力非全场最少（最简判定：取 alive players 最小）
    const self = state.players[player];
    if (!self) return false;
    const others = Object.entries(state.players)
      .filter(([name, p]) => name !== player && p.info.alive)
      .map(([_, p]) => p.health);
    const minHealth = others.length === 0 ? self.health : Math.min(...others);
    return self.health > minHealth;
  },
  onAfter: async (ctx) => {
    const { self, pending } = ctx;
    // body 由测试驱动（mock pending 返回玩家响应）
    const response = await pending<{ value: 'health' | 'maxHealth' }>({
      type: '选项',
      player: self,
      data: {},
      ui: {
        title: '崩坏',
        description: '请选择：减1点体力 或 减1点体力上限',
        options: [
          { value: 'health', label: '减1点体力' },
          { value: 'maxHealth', label: '减1点体力上限' },
        ],
      },
    });
    // response 是 T | ResumeData。'health' | 'maxHealth' 走健康路径；
    // {kind:'cancel'} / {kind:'timeout'} 走退出路径。
    if (typeof response === 'object' && response !== null && 'kind' in response) {
      return { kind: 'continue' };
    }
    const choice = response as 'health' | 'maxHealth';
    if (choice === 'health') {
      return {
        kind: 'additionalAtoms',
        atoms: [{ type: '失去体力', target: self, amount: 1 } as Atom],
      };
    }
    return {
      kind: 'additionalAtoms',
      atoms: [{ type: '设上限', player: self, delta: -1 } as Atom],
    };
  },
  metadata: {
    tutorial: '回合结束阶段，若体力不是全场最少，可减1点体力或减1点体力上限',
    defaultTimeout: 30000,
  },
};
