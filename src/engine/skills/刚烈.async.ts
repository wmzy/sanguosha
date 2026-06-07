// engine/skills/刚烈.async.ts — 刚烈（夏侯惇）AsyncHook 版本
//
// [P5-T2 / ADR 0025] 阶段 D-3 第 1 个示范：把 v2 老技能 trigger.event + SkillPhase
// 树翻译为 AsyncHook。规则：
// 1. 监听 造成伤害 atom onAfter
// 2. filter: target 是夏侯惇（characterId = '夏侯惇'）且 amount > 0
// 3. await ctx.judge() 同步跑判定 atom 读 suit
// 4. 红桃（♥）→ return continue
// 5. 否则 → await ctx.pending(选项) 等玩家选 "弃 2 张手牌" / "受 1 点伤害"
//
// 与 src/engine/skills/刚烈.ts v2 兜底并存。阶段 D 删 state.triggers 后 v2 兜底自然失效。

import type { AsyncHook } from '../async-hook';
import type { GameState, Atom } from '../types';

export const gangLieAsyncHook: AsyncHook = {
  id: 'ganglie-async',
  description: '夏侯惇 - 刚烈（async hook 版本）',
  atomType: '造成伤害',
  filter: (state: GameState, atom: Atom) => {
    if ((atom as Atom & { type: '造成伤害' }).type !== '造成伤害') return false;
    const target = (atom as Atom & { type: '造成伤害' }).target as string;
    if (state.players[target]?.info.characterId !== '夏侯惇') return false;
    const amount = (atom as Atom & { type: '造成伤害' }).amount as number;
    return amount > 0;
  },
  onAfter: async (ctx) => {
    const { state, atom, self, judge, pending, additionalAtoms } = ctx;
    void state;
    const damageAtom = atom as Atom & { type: '造成伤害' };
    const source = damageAtom.source as string;

    // 1) 同步判定
    const judgeResult = judge();
    // 2) 红桃 → 不触发
    if (judgeResult.suit === '♥') {
      return { kind: 'continue' };
    }

    // 3) 非红桃 → 等玩家选
    const response = await pending<'discard' | 'damage'>({
      type: '选项',
      player: source,
      data: { from: self, damageAmount: 1 },
      ui: {
        title: '刚烈',
        description: '请选择：弃置两张手牌，或受到1点伤害',
        options: [
          { value: 'discard', label: '弃置两张手牌' },
          { value: 'damage', label: '受到1点伤害' },
        ],
      },
    });
    if (typeof response === 'object' && response !== null && 'kind' in response) {
      return { kind: 'continue' };
    }
    if (response === 'damage') {
      // 来源受 1 点伤害
      return additionalAtoms([
        { type: '造成伤害', target: source, amount: 1, source: self } as Atom,
      ]);
    }
    // 弃 2 张手牌——v3 缺'选牌弃' atom，PoC 阶段 return continue（多步 prompt 留 follow-up）
    return { kind: 'continue' };
  },
  metadata: {
    tutorial: '受到伤害后，判定非红桃时，伤害来源可选择弃两张手牌或受1点伤害',
    aiPolicy: 'discardWhenPossible',
    defaultTimeout: 30000,
  },
};
