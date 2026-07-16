// src/engine/skills/急救.ts
// 急救(华佗·群雄):
//   回合外,你可以将一张红色手牌当【桃】使用。
//
// 模型:直接 respond action(对标 酒.respond "濒死时当桃用")。
//   回合外【桃】的唯一用途是濒死求桃救援——故急救只需一个 respond action:
//   当存在针对自己的 桃/求桃 pending 时,弃一张红色手牌,触发救援(求桃/已救)。
//   runDyingFlow 见此标志后对濒死角色 回复体力 +1。
//
// 设计说明:
//   - 严格"回合外":currentPlayerIndex !== ownerId(自己回合内应用真桃,而非急救)。
//   - 仅红色手牌(♥♦)。研究文档提及"装备区红色牌",但本引擎 转化/respond 体系
//     (当作 atom、武圣、酒.respond)均为手牌模型,且官方规则亦为"红色手牌";
//     装备区用法需额外卸载装备流程,超出当前范围,此处不实现(待澄清)。
//   - 与 酒.respond 同构:移动牌 手牌→弃牌堆 + 设 localVars['求桃/已救']。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '急救',
    description: '回合外,你可以将一张红色手牌当【桃】使用',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:濒死求桃时,将一张红色手牌当桃救援
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      // 回合外:自己回合内不得用急救(应用真桃)
      if (state.currentPlayerIndex === ownerId) return '急救只能在回合外使用';
      // 必须是针对自己的 桃/求桃 pending
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target?: number }).target !== ownerId) return '不是问你的';
      if (slot.atom.type !== '请求回应') return '当前不是求桃';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '桃/求桃') return '当前不是求桃';
      // 牌校验:必须是手中的红色牌
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (!card) return '牌不存在';
      if (card.color !== '红') return '只能使用红色牌';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 红色手牌进弃牌堆(与 桃.respond / 酒.respond 同构:直接 手牌→弃牌堆)
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '弃牌堆' },
      });
      // 标记已救援,runDyingFlow 据此对濒死角色回复 1 体力
      state.localVars['求桃/已救'] = true;
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '急救',
    style: 'primary',
    respondFor: '桃/求桃',
    prompt: {
      type: 'useCard',
      title: '急救：将一张红色手牌当桃使用',
      cardFilter: { filter: (c) => c.color === '红', min: 1, max: 1 },
    },
  });
}
