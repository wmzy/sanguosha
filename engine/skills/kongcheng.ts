// engine/skills/kongcheng.ts — 空城（诸葛亮）v3 registerAtomHook 演示
//
// 锁定技：若你没有手牌，【杀】和锦囊对你无效。
//
// v3 路径：监听 `becomeTarget` 原子。目标 = 诸葛亮 + 手牌为空 + 牌是基本牌/锦囊
// → 取消该 atom（不让目标正式确定）。
//
// 注：filter 用通用条件（手牌为空 + 牌类型）缩小范围，onBefore 再特化
// 到 characterId === '诸葛亮'。完整 v3 应在 filter 直接走 characterId。

import { registerSkill } from '../skill';
import { registerAtomHook } from '../atom';
import type { Atom } from '../types';

registerSkill({
  id: '空城',
  name: '空城',
  description: '锁定技，若你没有手牌，【杀】和锦囊对你无效。',
  trigger: { event: 'becomeTarget', source: 'character' },
  handler() {
    return [];
  },
});

registerAtomHook({
  atomType: 'becomeTarget',
  filter: (state, atom) => {
    const a = atom as Atom & { type: 'becomeTarget' };
    const target = a.target as string;
    const p = state.players[target];
    if (!p) return false;
    if (p.hand.length > 0) return false;
    const card = state.cardMap[a.cardId as string];
    return card?.type === '基本牌' || card?.type === '锦囊牌';
  },
  onBefore: (ctx) => {
    const atom = ctx.atom as Atom & { type: 'becomeTarget' };
    const target = atom.target as string;
    const char = ctx.state.players[target]?.info.characterId;
    if (char !== '诸葛亮') return {};
    return { cancel: true };
  },
});
