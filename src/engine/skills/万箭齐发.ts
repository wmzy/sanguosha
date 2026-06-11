// src/engine/skills/万箭齐发.ts
// 万箭齐发(锦囊):出牌阶段对所有其他角色使用,每名目标需出一张闪,否则受 1 点伤害
import type { BackendAPI, GameView, Json, EngineApi, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '万箭齐发', description: '对所有其他角色使用,每名目标需出闪,否则受 1 点伤害' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (_view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    },
    async (api: EngineApi) => {
      const from = api.self;
      const params = api.params;
      const cardId = params.cardId as string;
      const frame = api.pushFrame('万箭齐发', from, { ...params });

      // 初始化 settlement:所有其他存活角色
      const targets = api.state.players.filter(p => p.name !== from && p.alive).map(p => p.name);
      const settlement = targets.map(t => ({ target: t, dodged: false }));
      frame.params.settlement = settlement;

      // 移牌到处理区
      await api.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // ─── Promise-based 续跑 ───
      // 逐个询问闪,每个 respond action(闪技能)通过 frame.parent.params.settlement 标记 dodged
      for (const target of targets) {
        await api.apply({ type: '询问闪', target, source: from });
      }

      // 对未闪避者造成伤害
      const settled = frame.params.settlement as Array<{ target: string; dodged: boolean }>;
      for (const item of settled) {
        if (!item.dodged) {
          await api.apply({ type: '造成伤害', target: item.target, amount: 1, source: from });
        }
      }

      // 移牌到弃牌堆
      await api.apply({
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    },
  );
  return () => {};
}

export const module_万箭齐发: SkillModule = { createSkill, onInit };
registerSkillModule('万箭齐发', module_万箭齐发);
