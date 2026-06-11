// src/engine/skills/闪.ts
// 闪:需要使用或打出闪时,打出一张闪
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '闪', description: '需要使用或打出闪时,打出一张闪' };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'respond',
    (view: GameView, _params: Record<string, Json>) => {
      // cardId 为空表示不出闪 — 始终允许
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string | undefined;
      if (!cardId) return; // 不出闪,什么都不做
      // 移动闪到弃牌堆
      await api.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '弃牌堆' },
      });
      // 在当前帧(即杀帧)的 settlement 中标记 dodged
      const settlement = frame.params.settlement as Array<{ target: string; dodged: boolean }> | undefined;
      if (settlement) {
        const item = settlement.find(s => s.target === from);
        if (item) item.dodged = true;
      }
    },
  );
  return () => {};
}

export const module_闪: SkillModule = { createSkill, onInit };
registerSkillModule('闪', module_闪);
