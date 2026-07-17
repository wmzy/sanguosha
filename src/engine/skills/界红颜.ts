// 界红颜(界小乔·锁定技):你的黑桃牌和黑桃判定牌视为红桃牌。
//   若你的装备区里有红桃牌，你的手牌上限等于体力上限。
//
// 官方来源:三国杀 OL 界限突破 hero/457(逐字):
//   "锁定技，你的黑桃牌和黑桃判定牌视为红桃牌。若你的装备区里有红桃牌，
//    你的手牌上限等于体力上限。"
//
// 界版变化(相对标版 src/engine/skills/红颜.ts):
//   - 判定牌黑桃→红桃:与标版一致(判定 before hook 改花色)。
//   - 新增:装备区有红桃牌时,手牌上限 = 体力上限(覆盖型 provider,条件生效)。
//     无红桃装备时不返回(走默认公式 = 当前体力),不强行压低上限。
//
// 与天香的联动:界天香检查 skills.includes('红颜')||includes('界红颜'),
//   界小乔拥有界红颜时,黑桃手牌/装备也作为合法弃牌。
import type { AtomBeforeContext, Card, FrontendAPI, HookResult, Skill, GameState } from '../types';
import { registerBeforeHook } from '../skill';
import { registerHandLimitProvider } from '../hand-limit';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界红颜',
    description:
      '锁定技:你的黑桃牌和黑桃判定牌视为红桃牌;装备区有红桃牌时手牌上限等于体力上限',
  };
}

/** 装备区是否存在红桃牌 */
function hasHeartInEquipment(state: GameState, player: number): boolean {
  const equip = state.players[player]?.equipment ?? {};
  for (const id of Object.values(equip)) {
    if (!id) continue;
    const card = state.cardMap[id];
    if (card?.suit === '♥') return true;
  }
  return false;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // 判定 before:自己判定时,牌堆顶黑桃 → 红桃(在翻开前改花色,确保 toViewEvents 展示红桃)
  const unloadHook = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '判定',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number };
      if (atom.player !== ownerId) return;
      const topId = ctx.state.zones.deck[0];
      if (!topId) return;
      const card: Card | undefined = ctx.state.cardMap[topId];
      if (!card) return;
      if (card.suit !== '♠') return;
      card.suit = '♥';
      card.color = '红';
    },
  );

  // 手牌上限覆盖提供者:装备区有红桃牌时 = 体力上限
  const unloadProvider = registerHandLimitProvider(state, ownerId, (st, player) => {
    if (!hasHeartInEquipment(st, player)) return undefined;
    return st.players[player]?.maxHealth;
  });

  return () => {
    unloadHook();
    unloadProvider();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技:无主动 action
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
