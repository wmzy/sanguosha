// 苦肉(界黄盖·主动技,OL hero/307 官方逐字):
//   出牌阶段限一次，你可以弃置一张牌，然后失去1点体力。
//
// 界限突破(相对标苦肉 src/engine/skills/苦肉.ts):
//   1. 标苦肉:失去1点体力→摸2张,无次数限制。
//   2. 界苦肉(OL):弃置一张牌(手牌/装备)→失去1点体力(不摸牌),出牌阶段限一次。
//      摸牌效果移至锁定技「诈降」(失去体力后摸3张)。
//
// 代价:弃置一张牌(手牌或装备)——走 '弃置' atom(跨手牌/装备区)。
// 失去体力走 '失去体力' atom(非伤害——不触发伤害技,但触发诈降锁定技的 after-hook:
//   失去体力后摸3张,若在出牌阶段额外获得红色杀增益)。
// 体力归零进入濒死(求桃):引擎约定"失去体力后"技能(诈降)先于濒死检查触发
//   (runAfterHooks 把系统级 hook 排到最后),故诈降摸3先执行,再进入濒死求桃——
//   黄盖可借诈降摸到的桃自救(OL 经典连招)。
//
// 命名:文件名/loader key/character skill name 均为 '界苦肉'(避开标苦肉冲突);
//   内部 Skill.name = '苦肉'(OL 官方技能名,玩家可见)。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { activeUnlessUsedThisTurn, markOncePerTurn, usedThisTurn } from '../once-per-turn';
import { registerAction, type SkillModule } from '../skill';

/** skillId / loader key / once-per-turn key(与标苦肉隔离)。 */
const SKILL_ID = '界苦肉';
/** OL 官方技能名(玩家可见名)。 */
const DISPLAY_NAME = '苦肉';
const activeCheck = activeUnlessUsedThisTurn(SKILL_ID);

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '出牌阶段限一次，你可以弃置一张牌，然后失去1点体力。',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '只能在出牌阶段发动';
      if (usedThisTurn(state, ownerId, SKILL_ID)) return '本回合已使用过苦肉';
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      if (self.health <= 0) return '体力不足，无法发动苦肉';
      // 代价:弃置一张牌(手牌或装备)。兼容 cardIds 数组与单数 cardId。
      const cardIds =
        (params.cardIds as string[] | undefined) ??
        (typeof params.cardId === 'string' ? [params.cardId] : undefined);
      if (!Array.isArray(cardIds) || cardIds.length === 0) return '需选择一张牌弃置';
      if (cardIds.length > 1) return '苦肉只能弃置一张牌';
      const cardId = cardIds[0];
      const inHand = self.hand.includes(cardId);
      const inEquip = Object.values(self.equipment).includes(cardId);
      if (!inHand && !inEquip) return '牌不在手牌或装备区中';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      // 限一次标记:必须在第一个 await 之前设(防 dispatch 重入,见制衡.ts 注释)。
      await markOncePerTurn(state, from, SKILL_ID);
      const cardIds =
        (params.cardIds as string[] | undefined) ??
        (typeof params.cardId === 'string' ? [params.cardId] : []);
      await pushFrame(state, DISPLAY_NAME, from, {});
      // 1. 弃置一张牌(代价:手牌或装备)
      await applyAtom(state, { type: '弃置', player: from, cardIds });
      // 2. 失去 1 点体力(非伤害——触发诈降 after-hook:摸3张 + 出牌阶段红色杀增益)
      await applyAtom(state, { type: '失去体力', target: from, amount: 1 });
      await popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  void skill;
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'select',
      title: '苦肉：弃置一张牌，然后失去1点体力（出牌阶段限一次）',
      source: 'handAndEquip',
      minTotal: 1,
      maxTotal: 1,
    },
    activeWhen: (ctx) => {
      const me = ctx.view.players[ctx.perspectiveIdx];
      // 需有牌可弃(手牌或装备)且体力>0
      const hasCard = (me?.handCount ?? 0) + Object.values(me?.equipment ?? {}).length > 0;
      return activeCheck(ctx) && hasCard && (me?.health ?? 0) > 0;
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
