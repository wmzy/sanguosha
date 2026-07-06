// 火计(卧龙诸葛·转化技):你可以将一张红色手牌当【火攻】使用。
//
// 模型(组合 action,镜像武圣):前端选红牌 → 选目标(有手牌的其他角色) →
// 提交 preceding=[火计.transform] + 主 action=火攻.use。
// 后端 dispatch 先执行 火计.transform(创建影子火攻),再 火攻.use validate
// 看到"火攻"通过。火攻技能零感知火计——它看到的永远是 cardMap 里的"火攻"。
import type { Card, FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { registerAction, hasBlockingPending } from '../skill';
import { applyAtom } from '../create-engine';
import { defaultPlayActive } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '火计',
    description: '你可以将一张红色手牌当【火攻】使用',
  };
}

/** 影子卡 id:${原id}#火计 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#火计`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把红色手牌转化为影子"火攻"。
  // 作为 preceding 在 火攻.use 之前执行。火攻.validate 读 cardMap[影子id] 看到"火攻"。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活 + 手牌 + 红牌
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isRed = !!card && card.color === '红';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && isRed;
      return ok ? null : '现在不能使用火计';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '火攻',
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
  // 前端:火计是转化技,defineAction 声明红牌 + 目标(有手牌的其他角色)。
  // 前端 UI 流程:选红牌 → 选目标 → 提交 preceding=[火计.transform] + 主 action=火攻.use。
  api.defineAction('transform', {
    label: '火计',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色牌当火攻使用',
      cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 目标须有手牌(前端 UI 提示用,后端 validate 独立校验)
        filter: (view: GameView, t: number) => {
          if (t === view.currentPlayerIndex) return false;
          return (view.players[t]?.handCount ?? 0) > 0;
        },
      },
    },
    transform: (card: Card) => ({ name: '火攻', sourceCardId: card.id, fromSkill: skill.id }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return p.hand?.some((c) => c.color === '红') ?? false;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
