// src/engine/skills/决斗.ts
// 决斗(锦囊):出牌阶段对一名角色使用,双方轮流出杀,先不出者受 1 点伤害
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '决斗', description: '对一名角色使用,双方轮流出杀,先不出者受 1 点伤害' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (_view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      const target = params.target as string;

      // 移牌到处理区
      await api.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // ─── Promise-based 续跑 ───
      // 决斗循环:目标先出杀,之后发起者出杀,轮流
      let turn = 0; // 0=目标, 1=发起者
      let loser: string | null = null;
      while (loser === null) {
        const current = turn === 0 ? target : from;
        await api.apply({ type: '询问杀', target: current, source: turn === 0 ? from : target });
        // 询问杀挂起 → resolve 后读取回应
        const responded = frame.params.__决斗回应 as boolean | undefined;
        if (!responded) {
          loser = current;
        } else {
          turn = turn === 0 ? 1 : 0;
        }
      }
      const winner = loser === target ? from : target;
      await api.apply({ type: '造成伤害', target: loser, amount: 1, source: winner });
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

export const module_决斗: SkillModule = { createSkill, onInit };
registerSkillModule('决斗', module_决斗);
