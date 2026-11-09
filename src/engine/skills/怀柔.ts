import type { FrontendAPI, GameState, Skill, SkillModule } from '../types';
import { hasBlockingPending, registerAction } from '../core/skill';
import { recastCard } from '../flows/recast';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '怀柔', description: '出牌阶段，你可以重铸装备牌' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  return registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st, params) => {
      const cardIds = (params.cardIds as string[] | undefined) ??
        (typeof params.cardId === 'string' ? [params.cardId] : []);
      if (st.currentPlayerIndex !== ownerId || st.phase !== '出牌' || hasBlockingPending(st)) return '仅能在自己的出牌阶段使用';
      if (cardIds.length !== 1 || new Set(cardIds).size !== 1) return '请选择一张装备牌';
      const equipped = new Set(Object.values(st.players[ownerId]?.equipment ?? {}).filter((id): id is string => !!id));
      const inHand = st.players[ownerId]?.hand.includes(cardIds[0]) === true;
      const card = st.cardMap[cardIds[0]];
      if ((!inHand && !equipped.has(cardIds[0])) || card?.type !== '装备牌') return '请选择一张手牌或装备区的装备牌';
      return null;
    },
    async (st, params) => {
      const cardIds = (params.cardIds as string[] | undefined) ?? [params.cardId as string];
      await recastCard(st, ownerId, cardIds[0]);
    },
  );
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '怀柔',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'select',
      title: '怀柔：选择一张手牌或装备区的装备牌重铸',
      source: 'handAndEquip',
      filter: (card) => card.type === '装备牌',
      minTotal: 1,
      maxTotal: 1,
    },
    activeWhen: ({ view, perspectiveIdx }) =>
      perspectiveIdx === view.currentPlayerIndex && view.phase === '出牌' && !view.pending &&
      (Object.values(view.players[perspectiveIdx]?.equipment ?? {}).some(Boolean) ||
        (view.players[perspectiveIdx]?.hand ?? []).some((card) => card.type === '装备牌')),
  });
}

const module: SkillModule = { createSkill, onInit, onMount };
export default module;
