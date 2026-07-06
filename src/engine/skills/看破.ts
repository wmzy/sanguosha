// 看破(卧龙诸葛·转化技):你可以将一张黑色手牌当【无懈可击】使用。
//
// 模型(组合 action,镜像武圣但主 action 是 respond):
//   前端:无懈可击窗口期间,选黑牌 → 提交
//   preceding=[看破.transform] + 主 action=无懈可击.respond(影子cardId)。
//   后端 dispatch 先执行 看破.transform(创建影子无懈可击),再 无懈可击.respond
//   validate 检查 requestType='无懈可击' 且 card.name==='无懈可击' → 通过。
//   无懈可击技能零感知看破——它看到的永远是 cardMap 里的"无懈可击"。
//
// 关键:看破不受自己回合限制(无懈可击任意时机可打)。activeWhen 检测无懈可击
// 广播窗口(requestType='无懈可击',target<0)且有黑牌。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, hasBlockingPending } from '../skill';
import { applyAtom } from '../create-engine';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '看破',
    description: '你可以将一张黑色手牌当【无懈可击】使用',
  };
}

/** 影子卡 id:${原id}#看破 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#看破`;
}

/** 当前是否存在无懈可击广播窗口(玩家可回应) */
function hasNullifyWindow(state: GameState, playerId: number): boolean {
  for (const slot of state.pendingSlots.values()) {
    const atom = slot.atom as { type?: string; requestType?: string; target?: number };
    if (atom.type !== '请求回应') continue;
    if (atom.requestType !== '无懈可击') continue;
    // 广播型(target<0)或精确指向本玩家
    if (typeof atom.target === 'number' && (atom.target < 0 || atom.target === playerId)) return true;
  }
  return false;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把黑色手牌转化为影子"无懈可击"。
  // 作为 preceding 在 无懈可击.respond 之前执行。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 看破不受自己回合限制(无懈可击任意时机可打),但需有无懈窗口且无其他阻塞
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isBlack = !!card && card.color === '黑';
      // 必须存在无懈可击窗口(否则转化出的无懈无处使用)
      const hasWindow = hasNullifyWindow(state, ownerId);
      // 无其他阻塞型 pending(转化不应打断正在进行的结算);无懈窗口本身是当前响应目标,允许
      const blockedByOther = (() => {
        for (const slot of state.pendingSlots.values()) {
          const atom = slot.atom as { type?: string; requestType?: string };
          if (!slot.isBlocking) continue;
          if (atom.type === '请求回应' && atom.requestType === '无懈可击') continue;
          return true;
        }
        return false;
      })();
      const ok = cardInHand && isBlack && hasWindow && !blockedByOther;
      return ok ? null : '现在不能使用看破';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '无懈可击',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete state.cardMap[sId];
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('transform', {
    label: '看破',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张黑色牌当无懈可击使用',
      cardFilter: { filter: (c: Card) => c.color === '黑', min: 1, max: 1 },
    },
    transform: (card: Card) => ({
      name: '无懈可击',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      const view = ctx.view;
      const pending = view.pending;
      if (!pending) return false;
      // 无懈可击广播窗口:requestType='无懈可击'
      const atom = pending.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应' || atom.requestType !== '无懈可击') return false;
      const p = view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return p.hand?.some((c) => c.color === '黑') ?? false;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
