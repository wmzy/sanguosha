// engine/skills/wansha.ts — 完杀（贾诩）v3 registerAtomHook 演示
//
// 锁定技：在你的回合，除你以外，只有处于濒死状态的角色才能使用【桃】。
//
// v3 路径：监听 `heal` 原子。源（使用桃者）拥有完杀技能 + 救的目标 != 自己
// → 取消该 atom（桃只对自己生效）。
//
// 注：当前 `state.triggers` 中含 `skillId: '完杀' & player: <贾诩角色名>`
// 即可判定源拥有完杀（v2 桥梁）。完整 v3 应读 `players.<id>.skillsActive`
// —— P1+ 任务。

import { registerSkill } from '../skill';
import { registerAtomHook } from '../atom';
import type { Atom } from '../types';

registerSkill({
  id: '完杀',
  name: '完杀',
  description: '锁定技，在你的回合，除你以外，只有处于濒死状态的角色才能使用【桃】。',
  trigger: { event: 'heal', source: 'character' },
  handler() {
    return [];
  },
});

registerAtomHook({
  atomType: 'heal',
  filter: (state, atom) => {
    const a = atom as Atom & { type: 'heal' };
    // 救自己不阻
    if (a.target === a.source) return false;
    const source = (a.source ?? a.target) as string;
    return state.triggers.some(
      (t) => t.skillId === '完杀' && t.player === source,
    );
  },
  onBefore: () => ({ cancel: true }),
});
