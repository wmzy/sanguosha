// 无懈可击(锦囊):抵消一张锦囊牌的效果。任何角色可在锦囊生效前打出。
//
// 流程:
//   锦囊 execute → applyAtom(请求回应 无懈可击) → 检查 localVars['无懈/被抵消']
//     - 无人打 → 被抵消=false → 锦囊生效
//     - 有人打 → 无懈 respond execute:
//         移牌 → 翻转 localVars['无懈/被抵消'] → applyAtom(请求回应 无懈可击) 询问反无懈
//       dispatch 的 respond 路径是 await execute → resolve,
//       所以 respond 内部的反无懈询问会阻塞到反无懈完成,时序正确。
//       奇数次无懈 = 被抵消, 偶数次 = 恢复生效。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
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
  registerAction(
    skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      // 无懈可击是广播型(target=-2),不限制 ownerId,但仍需校验 pending 类型
      if (slot.atom.type !== '请求回应') return '当前不是无懈可击窗口';
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
      // 移无懈牌到弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '弃牌堆' },
      });

      // 翻转抵消状态:打出一张无懈 = 翻转当前锦囊是否被抵消
      const cancelled = state.localVars['无懈/被抵消'] as boolean | undefined;
      state.localVars['无懈/被抵消'] = !cancelled;

      // 无懈可击本身也是锦囊:询问是否有反无懈
      // dispatch respond 路径:await execute → resolve,
      // 这里的 applyAtom 会阻塞到反无懈窗口结束(无人打或继续递归)
      await applyAtom(state, {
        type: '请求回应',
        requestType: '无懈可击',
        target: -2,
        prompt: { type: 'useCard', title: '是否打出无懈可击抵消此无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } },
        timeout: 10,
      });
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '无懈可击',
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: '打出无懈可击',
      cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 },
    },
  });
}
