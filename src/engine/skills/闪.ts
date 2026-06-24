// 闪(基本牌):当你成为【杀】的目标时,可以打出【闪】抵消伤害。
// 闪只有 respond action(没有 use),因为闪不能主动使用。
// respond:把闪牌从手牌移到处理区(不是直接进弃牌堆),供杀的结算流程检查。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '闪', description: '需要打出闪时,打出一张闪' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      // pending 必须询问闪(正向条件)
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      if (slot.atom.type !== '询问闪') return '当前不是出闪的窗口';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (card?.name !== '闪') return '只能打出闪';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return; // 不出闪
      // 闪牌进处理区,供杀的结算流程检查处理区有没有闪
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '处理区' },
      });
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '出闪',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '打出闪',
      cardFilter: { filter: (c) => c.name === '闪', min: 1, max: 1 },
    },
  });
}

