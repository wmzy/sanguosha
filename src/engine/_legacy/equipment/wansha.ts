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

import type { HookRegistry } from '../skill-hook';
import type { Atom, GameState, SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '完杀',
    name: '完杀',
    description: '锁定技，在你的回合，除你以外，只有处于濒死状态的角色才能使用【桃】。',
    registerHooks(registry: HookRegistry) {
      registry.register({
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
    },
  },
];

/** 目标是否处于濒死状态：濒死窗口中 / 等待进入濒死窗口 / 体力 <= 0 但存活 */
function isTargetDying(state: GameState, target: string): boolean {
  if (state.deferredDyingCheck?.player === target) return true;
  if (state.pending?.type === '濒死窗口' && state.pending.dyingPlayer === target) return true;
  const p = state.players[target];
  return !!p && p.health <= 0 && p.info.alive;
}
