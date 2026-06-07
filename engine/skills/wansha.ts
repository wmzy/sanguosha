// engine/skills/wansha.ts — 完杀（贾诩）v3 registerAtomHook 演示
//
// 锁定技：在你的回合，除你以外，只有处于濒死状态的角色才能使用【桃】。
//
// v3 路径：监听 `heal` 原子。源（使用桃者）拥有完杀技能 + 救的目标 != 自己
// + 当前回合是贾诩 + 目标未濒死 → 取消该 atom（桃只对自己生效）。
//
// 濒死豁免：濒死窗口中允许他人用桃救（state.pending.type === 'dyingWindow'
// 或 state.deferredDyingCheck?.player === target，或目标体力 <= 0）。
//
// 注：当前 `state.triggers` 中含 `skillId: '完杀' & player: <贾诩角色名>`
// 即可判定源拥有完杀（v2 桥梁）。完整 v3 应读 `players.<id>.skillsActive`
// —— P1+ 任务。

import { registerSkill } from '../skill';
import { registerAtomHook } from '../atom';
import type { Atom, GameState } from '../types';

// v3-only skill：使用占位 trigger event 字符串 'v3HookOnly'。
// - v2 emitEvent 按 event.type 匹配 state.triggers，此 event 不在
//   GameEvent union 中，永远不会被 emitEvent 触发（不会走 v2 handler）
// - v2 targetHasSkill() 查 state.triggers 时仍能命中，支持 validate.ts
//   的 hasEmptyCityShield 等 v2 验证路径
// - 实际逻辑在下方 registerAtomHook 中
registerSkill({
  id: '完杀',
  name: '完杀',
  description: '锁定技，在你的回合，除你以外，只有处于濒死状态的角色才能使用【桃】。',
  trigger: { event: 'v3HookOnly', source: '角色' },
  handler() {
    return [];
  },
});
/** 目标是否处于濒死状态：濒死窗口中 / 等待进入濒死窗口 / 体力 <= 0 但存活 */
function isTargetDying(state: GameState, target: string): boolean {
  if (state.deferredDyingCheck?.player === target) return true;
  if (state.pending?.type === '濒死窗口' && state.pending.dyingPlayer === target) return true;
  const p = state.players[target];
  return !!p && p.health <= 0 && p.info.alive;
}

registerAtomHook({
  atomType: '回复体力',
  filter: (state, atom) => {
    const a = atom as Atom & { type: '回复体力' };
    // 救自己不阻
    if (a.target === a.source) return false;
    const source = a.source as string;
    const target = a.target as string;
    // 源必须拥有完杀（贾诩）。v3-only skill 不进入 state.triggers，按角色判定。
    if (state.players[source]?.info.characterId !== '贾诩') return false;
    // 完杀 只在贾诩的回合生效
    if (state.currentPlayer !== source) return false;
    // 濒死状态豁免：他人仍可救濒死的目标
    if (isTargetDying(state, target)) return false;
    return true;
  },
  onBefore: () => ({ cancel: true }),
});
