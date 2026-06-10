// src/engine/skills/杀.ts
// 杀:出牌阶段对攻击范围内一名角色使用,目标可出闪
// 计数:持久化到 player.marks(每回合 turn 结束自动清理)
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '杀', description: '出牌阶段对攻击范围内一名角色使用' };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      const targets = params.targets as string[] | undefined;
      if (!Array.isArray(targets) || targets.length === 0) return 'targets required';
      const self = view.players[view.viewer];
      const killsPlayed = self.marks
        .filter(m => m.id === '杀/killsPlayed')
        .reduce((n, m) => n + (typeof m.payload === 'number' ? m.payload : 0), 0);
      if (killsPlayed >= 1) return '出杀次数已用尽';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      const targets = params.targets as string[];
      frame.params.settlement = targets.map(t => ({ target: t, dodged: false }));
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      for (const item of frame.params.settlement as Array<{ target: string; dodged: boolean }>) {
        await frame.apply({ type: '指定目标', source: from, target: item.target });
        await frame.apply({ type: '询问闪', target: item.target, source: from });
      }
      // 酒 mark 由 酒 skill 的 onAtomBefore 钩子在 造成伤害 阶段读取并增加 amount
      for (const item of frame.params.settlement as Array<{ target: string; dodged: boolean }>) {
        if (!item.dodged) {
          await frame.apply({ type: '造成伤害', target: item.target, amount: 1, source: from, cardId });
        }
      }
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      // 持久化出杀次数到 player.marks(turn 结束自动清理)
      await frame.apply({
        type: '加标记',
        player: from,
        mark: { id: '杀/killsPlayed', scope: -1, payload: 1, duration: 'turn' },
      });
    },
  );
  return () => {};
}

export const module_杀: SkillModule = { createSkill, onInit };
registerSkillModule('杀', module_杀);
