// src/engine/skills/无懈可击.ts
// 无懈可击(锦囊):锦囊生效前可打出取消该锦囊
import type { BackendAPI, GameView, Json, EngineApi, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '无懈可击', description: '锦囊:取消一张锦囊牌的效果' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  // 注册 respond action:玩家打出无懈可击
  api.registerAction(
    'respond',
    (_view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    },
    async (api: EngineApi) => {
      const from = api.self;
      const params = api.params;
      const cardId = params.cardId as string;
      // 移无懈可击到弃牌堆
      await api.apply({ type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '弃牌堆' } });
      // 在当前帧标记无懈可击生效
      const frame = api.topFrame();
      if (frame) {
        frame.params.__无懈可击生效 = true;
      }
    },
  );
  return () => {};
}

export const module_无懈可击: SkillModule = { createSkill, onInit };
registerSkillModule('无懈可击', module_无懈可击);
