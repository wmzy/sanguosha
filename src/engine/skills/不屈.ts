// src/engine/skills/不屈.ts
// 不屈(周泰·锁定技,官方 hero 页逐字):
//   "当你处于濒死状态时,你将牌堆顶的一张牌置于你的武将牌上,称为'创',
//    若此牌点数与其他'创'均不同,你回复至1点体力,否则移去此牌。"
//
// 分析(步骤1):
//   类型:锁定技 | 时机:陷入濒死 after-hook(target===ownerId)
//   流程:
//     1. 置创牌{player=自己} —— 牌堆顶翻一张:不重复则置于武将牌,重复则移去(进弃牌堆)
//     2. 读 localVars['不屈/重复']:
//        - 不重复 → 回复体力{target=自己, amount=max(0,1-health)} 回复至1体力
//                   + 设 localVars['不屈/存活']=ownerId(runDyingFlow 据此跳过求桃+击杀)
//        - 重复   → 不设存活标记,runDyingFlow 继续求桃流程;无人救则击杀
//
//   钩子:registerAfterHook(state, skill.id, ownerId, '陷入濒死', handler)
//   关键:不屈成功时周泰回复至1体力(点数不重复)。"创"牌累积于 player.vars['不屈/创牌']。
//        runDyingFlow(系统规则.ts)在 陷入濒死 atom 后检查 localVars['不屈/存活'],
//        命中则清标记并 return,跳过求桃循环与击杀。
//
// 与界不屈的差异:界版额外有手牌上限规则(有创牌时手牌上限=创牌数量);标版无此规则。
//   二者共用 置创牌 atom(重复时移去此牌——对两版本语义一致)。
import type { AtomAfterContext, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

const SURVIVE_KEY = '不屈/存活';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '不屈',
    description: '锁定技:濒死时将牌堆顶一张牌作"创"牌置于武将牌上,点数与已有创牌均不同则回复至1体力,相同则移去此牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 陷入濒死 after-hook:不屈主逻辑(锁定技,每次濒死自动触发) ──
  registerAfterHook(state, skill.id, ownerId, '陷入濒死', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number };
    if (atom.target !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
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
      // 点数重复且已移去此牌:不屈失败,不设存活标记 → runDyingFlow 继续求桃,无人救则击杀
      return;
    }
    // 点数不同:不屈成功 → 回复至1体力(官方:"你回复至1点体力")
    const healthAfter = ctx.state.players[ownerId].health;
    const amount = Math.max(0, 1 - healthAfter);
    if (amount > 0) {
      await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount });
    }
    // 设存活标记供 runDyingFlow 跳过求桃+击杀
    ctx.state.localVars[SURVIVE_KEY] = ownerId;
  });

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
