// src/engine/skills/不屈.ts
// 不屈(周泰·锁定技):当你处于濒死状态时,你将牌堆顶一张牌作为"创"牌置于武将牌上,
// 若此牌点数与已有"创"牌均不同,你不死亡(以0体力存活);若点数相同,你死亡。
//
// 分析(步骤1):
//   类型:锁定技 | 时机:陷入濒死 after-hook(target===ownerId)
//   流程:
//     1. 置创牌{player=自己} —— 牌堆顶翻一张作创牌,atom 判定点数重复写入 localVars
//     2. 读 localVars['不屈/重复']:
//        - 不重复 → 设 localVars['不屈/存活']=ownerId(runDyingFlow 据此跳过求桃+击杀)
//        - 重复   → 不设标记,runDyingFlow 继续求桃流程;无人救则击杀
//
//   钩子:registerAfterHook(state, skill.id, ownerId, '陷入濒死', handler)
//   关键:不屈成功时周泰以0体力存活(不回复体力)。"创"牌累积于 player.vars['不屈/创牌']。
//        runDyingFlow(系统规则.ts)在 陷入濒死 atom 后检查 localVars['不屈/存活'],
//        命中则清标记并 return,跳过求桃循环与击杀。
//
// 文档矛盾(待澄清,已决策):文档"效果"写"回复至1体力",但"备注"5条与用户任务描述
//   均为"体力值为0/不死亡"。采用后者(标准三国杀规则):不屈成功不回复体力,以0体力存活。
import type { AtomAfterContext, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

const SURVIVE_KEY = '不屈/存活';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '不屈',
    description: '锁定技:濒死时将牌堆顶一张牌作"创"牌置于武将牌上,点数与已有创牌均不同则不死亡',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 陷入濒死 after-hook:不屈主逻辑(锁定技,每次濒死自动触发) ──
  registerAfterHook(state, skill.id, ownerId, '陷入濒死', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number };
    if (atom.target !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self || !self.alive) return;
    // 牌堆为空则无法置创牌(无法判定)——不屈失败,周泰进入正常求桃/死亡流程
    if (ctx.state.zones.deck.length === 0) return;

    // 清理上次不屈的临时判定结果
    delete ctx.state.localVars['不屈/重复'];

    // 置创牌:翻牌堆顶一张作创牌,atom 内部判定点数重复
    await applyAtom(ctx.state, { type: '置创牌', player: ownerId });

    const duplicate = ctx.state.localVars['不屈/重复'] as boolean | undefined;
    // 清理临时判定结果(仅存活标记需保留给 runDyingFlow 读取)
    delete ctx.state.localVars['不屈/重复'];

    if (duplicate) {
      // 点数重复:不屈失败,不设存活标记 → runDyingFlow 继续求桃,无人救则击杀
      return;
    }
    // 点数不同:不屈成功,周泰以0体力存活。设存活标记供 runDyingFlow 跳过击杀。
    ctx.state.localVars[SURVIVE_KEY] = ownerId;
  });

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
