// 无懈可击(锦囊):抵消一张锦囊牌的效果。任何角色可在锦囊生效前打出。
//
// 抵消机制(按目标独立):
//   全体锦囊(南蛮/万箭/桃园/五谷)对每个目标单独询问无懈,被抵消的目标跳过结算。
//   单目标锦囊(过河拆桥/借刀杀人/决斗)抵消整个锦囊。
//   延时锦囊(乐/兵粮/闪电)在判定前抵消整个延时锦囊。
//
// 流程:
//   锦囊 execute → askWuxie(state, wuxieTarget) → 检查 localVars[`无懈/被抵消/${wuxieTarget}`]
//     - 无人打 → 被抵消=false → 对该目标生效
//     - 有人打 → 无懈 respond execute:
//         移牌 → 翻转 localVars[`无懈/被抵消/${wuxieTarget}`] → slot.resume() 重启定时器
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

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
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

      // 确定本次抵消的目标:从当前 broadcast slot 的 atom.wuxieTarget 读取。
      // - 全体锦囊:wuxieTarget = 某个具体目标座次 N
      // - 单目标/延时锦囊:wuxieTarget = 该锦囊的目标座次
      // 找不到 wuxieTarget 时(旧调用路径)退化为整体抵消 key='_all'
      const slot = state.pendingSlots.get(ownerId)
        ?? [...state.pendingSlots.values()].find(s => {
          const a = s.atom as { type?: string; requestType?: string; target?: unknown };
          return a.type === '请求回应' && a.requestType === '无懈可击' && typeof a.target === 'number' && a.target < 0;
        });
      const wuxieAtom = slot?.atom as { wuxieTarget?: number } | undefined;
      const wuxieTarget = typeof wuxieAtom?.wuxieTarget === 'number' ? wuxieAtom.wuxieTarget : -1;
      const cancelKey = `无懈/被抵消/${wuxieTarget}`;

      // 翻转抵消状态:打出一张无懈 = 翻转当前锦囊对 wuxieTarget 是否被抵消
      const cancelled = state.localVars[cancelKey] as boolean | undefined;
      state.localVars[cancelKey] = !cancelled;

      // 重新激活 broadcast slot(target=-2),让原窗口继续接受反无懈等更多回应。
      // slot.resume() 重置定时器为满 timeout 并标记 _keepAlive=true;
      // dispatch 在 respond execute 完成后看到 _keepAlive=true 时不会 resolve,
      // 直到定时器自然过期才结束窗口。
      slot?.resume?.();
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
