// src/engine/skills/无懈可击.ts
// 无懈可击(锦囊):抵消一张锦囊牌的效果。任何角色可在锦囊生效前打出。
//
// 机制:dispatch 广播 pending(请求回应 requestType='无懈可击'),任何存活玩家可 respond。
// 父锦囊 execute 用循环收集无懈数量,奇偶判定原锦囊是否生效。
import type { GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '无懈可击',
    description: '抵消一张锦囊牌的效果',
  };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  // use:出牌阶段不能主动使用无懈可击
  registerAction(
    skill.id, ownerId, 'use',
    () => '无懈可击只能在锦囊生效前使用',
    async () => {},
  );

  // respond:广播 pending 请求回应时,任何玩家可打出无懈可击
  registerAction(
    skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlot;
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '无懈可击') return '当前不是无懈可击窗口';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self?.alive) return '你已死亡';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (card.name !== '无懈可击') return '只能打出无懈可击';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 无懈可击进弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '弃牌堆' },
      });
      // 标记本轮有人打无懈(锦囊 execute 的循环读这个)
      state.localVars['无懈/本轮已打'] = true;
    },
  );
  return () => {};
}

/**
 * 在锦囊 execute 中调用:轮询询问无懈,返回原锦囊是否生效。
 * 奇数无懈 = 被抵消(false),偶数 = 生效(true)。
 *
 * 用法:const 生效 = await settleWithWuxie(state);
 */
export async function settleWithWuxie(state: GameState): Promise<boolean> {
  let count = 0;
  while (true) {
    delete state.localVars['无懈/本轮已打'];
    await applyAtom(state, {
      type: '请求回应',
      requestType: '无懈可击',
      target: -2,  // 广播标记(dispatch 检查 requestType 而非 target)
      prompt: {
        type: 'useCard',
        title: '是否打出无懈可击?',
        cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 },
      },
      timeout: 10,
    });
    if (!state.localVars['无懈/本轮已打']) break;  // 超时=无人打
    count++;
  }
  return count % 2 === 0;  // 偶数=原锦囊生效
}

export default { createSkill, onInit } satisfies SkillModule;
