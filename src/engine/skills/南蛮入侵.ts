// src/engine/skills/南蛮入侵.ts
// 南蛮入侵(锦囊):出牌阶段对所有其他角色使用,每名目标需出一张杀,否则受 1 点伤害
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '南蛮入侵', description: '对所有其他角色使用,每名目标需出杀,否则受 1 点伤害' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const cardId = params.cardId as string;
      const frame = pushFrame(state, '南蛮入侵', from, { ...params });

      // 初始化 settlement:所有其他存活角色
      const targets = state.players.filter(p => p.name !== from && p.alive).map(p => p.name);
      const settlement = targets.map(t => ({ target: t, dodged: false }));
      frame.params.settlement = settlement;

      // 移牌到处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // ─── Promise-based 续跑 ───
      // 逐个询问杀:每个 target 的 respond action(如果有)会通过 frame.parent
      // 设置 settlement[i].dodged
      for (const target of targets) {
        await applyAtom(state, { type: '询问杀', target, source: from });
      }

      // 对未出杀者造成伤害
      const settled = frame.params.settlement as Array<{ target: string; dodged: boolean }>;
      for (const item of settled) {
        if (!item.dodged) {
          await applyAtom(state, { type: '造成伤害', target: item.target, amount: 1, source: from });
        }
      }

      // 移牌到弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
