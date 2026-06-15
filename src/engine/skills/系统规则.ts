// 系统规则(系统级):注册引擎级 after hooks——判定清理、技能生命周期、濒死流程。
// 这些是三国杀全局规则,不是单个技能职责,通过 after hooks 统一处理。
// applyAtom 只管通用管线(before → validate → apply → emit → after hooks → pending)。
import type { GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, instantiateSkill, unloadSkillInstance, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '系统规则', description: '引擎级规则(判定清理/技能生命周期/濒死)' };
}

export function onInit(_skill: Skill, _ownerId: number): () => void {
  // ── 添加技能 after hook:实例化技能(注册 action/hook) ──
  registerAfterHook('系统规则', -1, '添加技能', async (ctx) => {
    const atom = ctx.atom as { skillId: string; player: number };
    await instantiateSkill(atom.skillId, atom.player);
  });

  // ── 移除技能 after hook:卸载技能实例 ──
  registerAfterHook('系统规则', -1, '移除技能', async (ctx) => {
    const atom = ctx.atom as { skillId: string; player: number };
    unloadSkillInstance(atom.skillId, atom.player);
  });

  // ── 造成伤害 after hook:濒死检查(最后执行,确保遗计等技能先触发) ──
  registerAfterHook('系统规则', -1, '造成伤害', async (ctx) => {
    const atom = ctx.atom as { target?: number };
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  // ── 失去体力 after hook:濒死检查(最后执行) ──
  registerAfterHook('系统规则', -1, '失去体力', async (ctx) => {
    const atom = ctx.atom as { target?: number };
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  return () => {};
}

/**
 * 濒死求桃流程:从濒死玩家开始,按座次依次询问每个存活玩家是否使用桃救援。
 */
async function runDyingFlow(state: GameState, targetIdx: number): Promise<void> {
  await applyAtom(state, { type: '陷入濒死', target: targetIdx });

  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    const playerIdx = (targetIdx + i) % n;
    const player = state.players[playerIdx];
    if (!player.alive) continue;
    if (state.players[targetIdx].health > 0) return;

    await applyAtom(state, {
      type: '请求回应',
      requestType: '求桃',
      target: playerIdx,
      prompt: { type: 'confirm', title: `${state.players[targetIdx].name} 濒死,是否使用桃救援?`, confirmLabel: '出桃', cancelLabel: '不救' },
      timeout: 15,
    });

    const rescuedByPeach = state.localVars['求桃/已救'] as boolean | undefined;
    if (rescuedByPeach) {
      await applyAtom(state, { type: '回复体力', target: targetIdx, amount: 1, source: playerIdx });
      delete state.localVars['求桃/已救'];
      if (state.players[targetIdx].health > 0) return;
    }
  }

  if (state.players[targetIdx].health <= 0) {
    await applyAtom(state, { type: '击杀', player: targetIdx });
  }
}
