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
    (view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      const settlement = frame.params.settlement as Array<{ target: string; dodged: boolean }> | undefined;
      if (settlement) {
        const item = settlement.find(s => s.target === from);
        if (item) item.dodged = true;
      }
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    },
  );
  return () => {};
}

export const module_闪: SkillModule = { createSkill, onInit };
registerSkillModule('闪', module_闪);
