// 巨象(祝融·锁定技):【南蛮入侵】对你无效;若其他角色使用的【南蛮入侵】在结算完时
// 进入弃牌堆,你立即获得它。
//
// 分析(步骤1):
//   类型:锁定技 | 时机:南蛮入侵结算时 + 南蛮入侵进入弃牌堆时
//   效果A(免疫):与祸首完全相同机制
//     - 询问杀 before-hook(target=owner 且 当前帧=南蛮入侵)→ cancel(不被询问出杀)
//     - 造成伤害 before-hook(card=南蛮入侵 且 target=owner)→ cancel(不受伤害)
//   效果B(获得):其他角色使用的南蛮入侵结算后进入弃牌堆时,祝融获得它
//     - 移动牌 after-hook(card=南蛮入侵 且 from=处理区 且 to=弃牌堆 且 帧发起人≠owner)
//       → 再发一个 移动牌(弃牌堆→祝融手牌)把牌拿走
//   契约:无 localVars/vars(纯锁定技)。
//   精确判断"使用":南蛮入侵只有 处理区→弃牌堆 这一路径(打出/弃置是 手牌→弃牌堆,不经过处理区)。
//   "其他角色":南蛮入侵结算帧 topFrame.from = 使用者;from≠owner 才触发获得。
//   注:不用「获得」atom——它不清理弃牌堆(apply 仅过滤来源玩家手牌/装备)。
//       改用「移动牌」(弃牌堆→手牌),其 default applyView 正确同步 discardPileCount-1 与 handCount+1。
import type { FrontendAPI, GameState, HookResult, Skill } from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAfterHook, registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '巨象',
    description: '锁定技:南蛮入侵对你无效;其他角色使用的南蛮入侵结算后进入弃牌堆时,你获得它',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── 效果A(1):祝融不被南蛮入侵询问出杀 ───
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

  // ─── 效果A(2):南蛮入侵对祝融造成的伤害无效 ───
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '受到伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (!atom.cardId) return;
      if (ctx.state.cardMap[atom.cardId]?.name !== '南蛮入侵') return;
      return { kind: 'cancel' };
    },
  );

  // ─── 效果B:其他角色使用的南蛮入侵结算后进弃牌堆时,祝融获得它 ───
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (!atom.cardId) return;
    if (atom.from?.zone !== '处理区') return;
    if (atom.to?.zone !== '弃牌堆') return;
    const card = ctx.state.cardMap[atom.cardId];
    if (card?.name !== '南蛮入侵') return;
    // 南蛮入侵结算帧:topFrame.from = 使用者;使用者≠祝融 才获得
    const frame = topFrame(ctx.state);
    if (frame?.skillId !== '南蛮入侵') return;
    if (frame.from === ownerId) return;
    // 祝融需存活才能获得
    if (ctx.state.players[ownerId]?.alive !== true) return;
    // 把牌从弃牌堆移到祝融手牌(此时牌刚进弃牌堆)。
    // 用「移动牌」而非「获得」:获得 atom 不清理弃牌堆;移动牌的 default applyView
    // 正确同步 discardPileCount-1 与 handCount+1。
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: atom.cardId,
      from: { zone: '弃牌堆' },
      to: { zone: '手牌', player: ownerId },
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技:无可主动发动的 action
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
