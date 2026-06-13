// src/engine/skills/闪.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   当你需要使用或打出一张【闪】时,可以将一张【闪】打出/使用。
//   【闪】不能在出牌阶段主动使用(除非有特殊技能);其他时机由系统询问出闪。
//
// 关键原子操作:
//   respond 路径:
//     移动牌(手牌→弃牌堆) → mutate parent frame.settlement.dodged=true
//   不出闪(cardId 为空):空操作直接 return,由询问闪 atom 的 onTimeout='无操作' 收尾
//
// 关键时机:
//   - 仅在被询问闪(询问闪 atom pending)时调用;由 dispatch 把回应注入 frame.params
//   - 不调用 pushFrame/popFrame——闪是"附加到杀帧"的回应,settlement 标记直接 mutate parent frame
//
// 已知问题/不完整实现:
//   1. validate 永远 return null——没有验证 cardId 是不是合法的闪,
//      也不验证 ownerId 是不是杀的目标(应该已由 dispatch 路由层过滤,但属于防御缺失)。
//   2. respond 的 settlement.dodged 字段语义被【杀.ts】respond 复用为"出杀响应了决斗",
//      字段语义未拆分,后续添加新响应方式(如 闪转化为杀)时容易冲突。
//   3. 没有为其他技能消费提供 hook 点(如"使用/打出闪后")——
//      标准三国杀中"草船借箭/防具洛神"等技能需要"闪相关"事件,目前没有标签/事件可消费。
//   4. 万箭齐发/借刀杀人 等"打出闪"与"使用闪" 的语义差异目前没区分,
//      统一走 respond — 大部分场景没问题,但与某些需要区分二者的技能(如裸衣)不兼容。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '闪', description: '需要使用或打出闪时,打出一张闪' };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAction(skill.id, ownerId, 'respond', (state: GameState, params: Record<string, Json>) => {
      // cardId 为空表示不出闪 — 始终允许
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const cardId = params.cardId as string | undefined;
      if (!cardId) return; // 不出闪,什么都不做
      // 移动闪到弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '弃牌堆' },
      });
      // 在当前帧(即杀帧)的 settlement 中标记 dodged
      const frame = topFrame(state);
      if (frame) {
        const settlement = frame.params.settlement as Array<{ target: string; dodged: boolean }> | undefined;
        if (settlement) {
          const item = settlement.find(s => s.target === from);
          if (item) item.dodged = true;
        }
      }
    }, );
  return () => {};
}

export default { createSkill, onInit };
