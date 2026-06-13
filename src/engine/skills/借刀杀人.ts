// src/engine/skills/借刀杀人.ts
// 借刀杀人(锦囊):获得目标武器,或令目标对指定角色出杀
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '借刀杀人', description: '锦囊:获得目标武器,或令目标出杀' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as string;
      const frame = pushFrame(state, '借刀杀人', from, { ...params });
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // ─── Promise-based 续跑 ───
      // 请求回应挂起,等目标出杀或超时
      await applyAtom(state, {
        type: '请求回应',
        requestType: '借刀杀人/forceKill',
        target,
        prompt: { type: 'confirm', title: '借刀杀人:是否对指定角色出杀?', confirmLabel: '出杀', cancelLabel: '不出(失武器)' },
        defaultChoice: false,
        timeout: 15000,
      });
      // 回应到达后读结果
      const killed = frame.params.__借刀杀回应 as boolean | undefined;
      if (!killed) {
        // 不出杀:获得目标的武器
        const targetPlayer = state.players.find(p => p.name === target);
        const weaponId = targetPlayer?.equipment?.['武器'];
        if (weaponId) {
          await applyAtom(state, { type: '卸下', player: target, slot: '武器' });
          await applyAtom(state, { type: '获得', player: from, cardId: weaponId, from: target });
        }
      }
      // 移牌到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
