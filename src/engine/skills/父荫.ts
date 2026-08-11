// 父荫(诸葛瞻·蜀·锁定技,OL hero/410 风林火山官方逐字):
//   "锁定技,当你每回合首次成为其他角色【杀】或【决斗】的目标后,
//    若其手牌数不小于你,此牌对你无效。"
//
// 时机:检测有效性 before-hook(cancel = 此牌对你无效,镜像仁王盾/享乐)。
//   "对你无效"走 检测有效性 cancel(§1.6.7):cancel 后 runSettlementPhase 跳过该目标,
//   不询问闪/杀、不造成伤害、不触发被抵消——决斗的 runDuelLoop 也被跳过。
//
// 触发条件(全部满足才判定):
//   - target===自己 且 source!==自己(其他角色)
//   - 当前结算牌为 杀 或 决斗
//   - 本回合首次触发(限一次):player.vars['父荫/usedThisTurn'],由 回合结束 atom 自动清空
//
// 效果:首次触发即消耗"每回合一次"机会(无论手牌条件是否满足);
//   若其手牌数 >= 自己手牌数 → cancel(此牌对你无效);否则牌正常结算。
import type { FrontendAPI, GameState, HookResult, Skill } from '../types';
import { registerBeforeHook } from '../core/skill';
import { usedThisTurn } from '../rules/once-per-turn';
import type { SkillModule } from '../types';

const SKILL_ID = '父荫';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description: '锁定技:每回合首次成为其他角色杀或决斗的目标后,若其手牌数不小于你,此牌对你无效',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '检测有效性',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      const source = atom.source;
      if (source === undefined || source === ownerId) return; // 仅其他角色
      const cardId = atom.cardId;
      if (!cardId) return;
      const card = ctx.state.cardMap[cardId];
      if (!card) return;
      if (card.name !== '杀' && card.name !== '决斗') return; // 仅杀/决斗

      // 每回合首次:已触发过则不再生效
      if (usedThisTurn(ctx.state, ownerId, SKILL_ID)) return;

      // 消耗本回合唯一机会(无论后续手牌条件是否满足)——直接写 vars,
      // 由 回合结束 atom 按 '/usedThisTurn' 后缀自动清空
      ctx.state.players[ownerId].vars[`${SKILL_ID}/usedThisTurn`] = true;

      const sourcePlayer = ctx.state.players[source];
      const selfPlayer = ctx.state.players[ownerId];
      if (!sourcePlayer || !selfPlayer) return;
      // 其手牌数不小于你 → 此牌对你无效(cancel)
      if (sourcePlayer.hand.length >= selfPlayer.hand.length) {
        return { kind: 'cancel' };
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技,无主动 action UI(纯 before-hook 自动触发)
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
