// 祸首(孟获·锁定技):【南蛮入侵】对你无效;你是任何【南蛮入侵】造成伤害的来源。
//
// 分析(步骤1):
//   类型:锁定技 | 时机:南蛮入侵结算时
//   两个效果:
//     A. 南蛮入侵对孟获无效(免疫):
//        - 询问杀 before-hook(target=孟获 且 当前帧=南蛮入侵)→ cancel(孟获不被询问出杀)
//        - 造成伤害 before-hook(target=孟获 且 card=南蛮入侵)→ cancel(孟获不受南蛮伤害)
//        两处都拦截:南蛮入侵流程不调用 成为目标/检测有效性,故只能挂 询问杀 + 造成伤害。
//     B. 孟获是任何南蛮入侵伤害的来源:
//        - 造成伤害 before-hook(card=南蛮入侵 且 孟获存活 且 source≠孟获 且 target≠孟获)
//          → modify,把 source 改为孟获
//   契约:无 localVars/vars(纯锁定技)。造成伤害的 cardId 指向南蛮入侵牌(结算期间仍在处理区)。
//   说明:不修改 南蛮入侵.ts——用 hook 解耦,且不破坏现有测试。A 与 B 在同一 造成伤害 hook 中
//        分支处理(target=孟获→cancel;否则→modify source)。
import type { FrontendAPI, GameState, HookResult, Skill } from '../types';
import { topFrame } from '../create-engine';
import { registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '祸首',
    description: '锁定技:南蛮入侵对你无效;你是任何南蛮入侵造成伤害的来源',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── 效果A(1):孟获不被南蛮入侵询问出杀 ───
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问杀',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      // 仅南蛮入侵结算中(决斗等也用 询问杀,需区分)
      if (topFrame(ctx.state)?.skillId !== '南蛮入侵') return;
      return { kind: 'cancel' };
    },
  );

  // ─── 效果A(2) + 效果B:南蛮入侵的伤害结算 ───
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '伤害结算开始时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (!atom.cardId) return;
      if (ctx.state.cardMap[atom.cardId]?.name !== '南蛮入侵') return;

      const mengAlive = ctx.state.players[ownerId]?.alive === true;

      // 效果A:南蛮入侵对孟获无效
      if (atom.target === ownerId) {
        return { kind: 'cancel' };
      }

      // 效果B:孟获是伤害来源(孟获存活且当前来源不是孟获)
      if (mengAlive && atom.source !== undefined && atom.source !== ownerId) {
        return { kind: 'modify', atom: { ...ctx.atom, source: ownerId } as typeof ctx.atom };
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技:无可主动发动的 action,无需 defineAction
  return undefined;
}

export default { createSkill, onInit, onMount };
