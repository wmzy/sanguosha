// src/engine/skills/万箭齐发.ts
// 万箭齐发(锦囊):出牌阶段对所有其他角色使用,每名目标需出一张闪,否则受 1 点伤害
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '万箭齐发', description: '对所有其他角色使用,每名目标需出闪,否则受 1 点伤害' };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (_view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;

      // 初始化 settlement:所有其他存活角色
      const targets = frame._executor
        ? frame._executor.state.players.filter(p => p.name !== from && p.alive).map(p => p.name)
        : [];
      const settlement = targets.map(t => ({ target: t, dodged: false }));
      frame.params.settlement = settlement;

      // 移牌到处理区
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 注册续跑:逐个询问闪后的处理
      let index = 0;
      frame._continueFn = async () => {
        // 检查当前目标是否出闪
        const current = settlement[index];
        if (current) {
          const dodged = frame.params.__万箭dodged as boolean | undefined;
          if (dodged) current.dodged = true;
        }
        index++;
        // 如果还有下一个目标,继续询问
        if (index < settlement.length) {
          const next = settlement[index];
          await frame.apply({
            type: '询问闪',
            target: next.target,
            source: from,
          });
          // 询问闪会暂停,等 dispatch 调 _continueFn
        } else {
          // 全部询问完毕,对未闪避者造成伤害
          for (const item of settlement) {
            if (!item.dodged) {
              await frame.apply({ type: '造成伤害', target: item.target, amount: 1, source: from });
            }
          }
          // 移牌到弃牌堆
          await frame.apply({
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
      };

      // 第一个目标
      if (settlement.length > 0) {
        await frame.apply({
          type: '询问闪',
          target: settlement[0].target,
          source: from,
        });
      }
    },
  );
  return () => {};
}

export const module_万箭齐发: SkillModule = { createSkill, onInit };
registerSkillModule('万箭齐发', module_万箭齐发);
