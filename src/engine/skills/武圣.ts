// src/engine/skills/武圣.ts
// 武圣(关羽·转化技):将一张红色牌当【杀】使用或打出。
//
// 模型(组合 action):前端两步 UI(点武圣给红牌加"杀"显示 → 点出杀选目标),
// 提交时一个 ClientMessage:preceding=[武圣.transform] + 主 action=杀.use。
// 后端 dispatch 先执行 武圣.transform(创建影子杀),再 杀.use validate 看到"杀"通过。
// 杀技能零感知武圣——它看到的永远是 cardMap 里的一张"杀"。
import type { Card, CardWrapper, GameState, Json, Skill } from '../types';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '武圣',
    description: '你可以将一张红色牌当【杀】使用或打出',
  };
}

/** 影子卡 id:${原id}#武圣 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#武圣`;
}

export function onInit(skill: Skill, ownerId: number): () => void {
  // transform action:把红色手牌转化为影子"杀"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 杀.use 之前执行。杀.validate 读 cardMap[影子id] 看到"杀"。
  registerAction(
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 无 pending + 存活 + 手牌 + 红牌
      const myTurn = state.currentPlayerIndex === ownerId;
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self?.hand.includes(cardId);
      const isRed = !!card && (card.suit === '♥' || card.suit === '♦');
      const ok = myTurn && free && selfAlive && cardInHand && isRed;
      return ok ? null : '现在不能使用武圣';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const orig = state.cardMap[cardId];
      const sId = shadowIdOf(cardId);
      // 新建影子卡:name='杀',其余属性同原卡,shadowOf 指向原卡
      const shadow: Card = {
        id: sId,
        name: '杀',
        suit: orig.suit,
        rank: orig.rank,
        type: '基本牌',
        shadowOf: cardId,
      };
      state.cardMap[sId] = shadow;
      // 手牌:原卡替换为影子卡(玩家"持有"这张杀)
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(cardId);
      if (idx >= 0) self.hand[idx] = sId;
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

export function onMount(skill: Skill, api: { defineAction: Function }): void {
  // 前端:武圣是转化技,defineAction 声明红牌+目标。
  // 前端 UI 流程:选红牌 → 选目标 → 点武圣按钮 → 提交 preceding=[武圣.transform] + 主 action=杀.use。
  api.defineAction('transform', {
    label: '武圣',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色牌当杀使用',
      cardFilter: { filter: (c: Card) => c.suit === '♥' || c.suit === '♦', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
    transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: skill.id } as CardWrapper),
  });
  return;
}

