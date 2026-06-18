// 无懈可击(锦囊):抵消一张锦囊牌的效果。任何角色可在锦囊生效前打出。
//
// 流程:
//   锦囊 execute → applyAtom(请求回应 无懈可击) → 检查 localVars['无懈/被抵消']
//     - 无人打 → 被抵消=false → 锦囊生效
//     - 有人打 → 无懈 respond execute:
//         移牌 → 翻转 localVars['无懈/被抵消'] → slot.resume() 重启定时器
//       respond execute 不创建新的 pending(避免与原 key=-2 slot 冲突),
//       而是直接调 slot.resume() 让原 slot 定时器重置为满 timeout,
//       同一窗口继续接受反无懈等更多回应。
//       dispatch 在 respond execute 完成后看到 slot 仍挂在 Map 上 → 不 resolve,
//       让定时器自然过期后才结束窗口。奇数次无懈 = 被抵消, 偶数次 = 恢复生效。
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
      // 无懈可击是广播型(target=-2):先按 ownerId 查(并行询问场景下 ownerId 也可能命中),
      // 未命中时查找广播型 slot(任何存活角色都可 respond)。
      const slot = state.pendingSlots.get(ownerId)
        ?? [...state.pendingSlots.values()].find(s => {
          const a = s.atom as { type?: string; requestType?: string; target?: unknown };
          return a.type === '请求回应' && a.requestType === '无懈可击' && typeof a.target === 'number' && a.target < 0;
        });
      if (!slot) return '当前不需要回应';
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

      // 找到被 respond 的原 slot 并 resume:同一个窗口继续接受反无懈等更多回应。
      // 无懈是广播型(target=-2),slot key = -2;按 ownerId 查不到,需要遍历 Map
      // 找广播型 slot(resume 后该 slot 仍接受 respond,奇数次 = 抵消,偶数次 = 恢复)。
      const broadcastSlot = [...state.pendingSlots.values()].find(s => {
        const a = s.atom as { type?: string; target?: unknown; requestType?: string };
        return a.type === '请求回应' && a.requestType === '无懈可击' && typeof a.target === 'number' && a.target < 0;
      });
      broadcastSlot?.resume?.();
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
