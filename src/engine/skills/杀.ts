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
      // 距离检查:目标必须在攻击范围内
      const WEAPON_RANGE: Record<string, number> = {
        '诸葛连弩': 1, '青釭剑': 2, '雌雄双股剑': 2, '贯石斧': 3,
        '青龙偃月刀': 3, '丈八蛇矛': 3, '方天画戟': 4, '麒麟弓': 5, '寒冰剑': 2,
      };
      let range = 1;
      const weaponId = self.equipment?.['武器'];
      if (weaponId) {
        const weapon = view.cardMap[weaponId];
        if (weapon) range = WEAPON_RANGE[weapon.name] ?? 1;
      }
      const alive = view.players.filter(p => p.alive);
      const aliveSelfIdx = alive.findIndex(p => p.name === self.name);
      for (const targetName of targets) {
        const aliveToIdx = alive.findIndex(p => p.name === targetName);
        if (aliveToIdx < 0) return `target ${targetName} not found`;
        const n = alive.length;
        const d = Math.abs(aliveSelfIdx - aliveToIdx);
        let dist = Math.min(d, n - d);
        if (self.equipment?.['进攻马']) dist -= 1;
        const targetPlayer = view.players.find(p => p.name === targetName);
        if (targetPlayer?.equipment?.['防御马']) dist += 1;
        dist = Math.max(1, dist);
        if (dist > range) return `目标 ${targetName} 不在攻击范围内(距离${dist},范围${range})`;
      }
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      const targets = params.targets as string[];
      frame.params.settlement = targets.map(t => ({ target: t, dodged: false }));
      frame.params.cardId = cardId;
      // 注册续跑函数:dispatch 收到闪回应后调此函数跑"造成伤害+弃牌"
      frame._continueFn = async () => {
        const settlement = frame.params.settlement as Array<{ target: string; dodged: boolean }>;
        for (const item of settlement) {
          if (!item.dodged) {
            await frame.apply({ type: '造成伤害', target: item.target, amount: 1, source: frame.from });
          }
        }
        await frame.apply({
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      };
      // 移动杀到处理区
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      for (const target of targets) {
        await frame.apply({ type: '指定目标', source: from, target });
        await frame.apply({ type: '询问闪', target, source: from });
      }
    },
  );
  return () => {};
}

export const module_杀: SkillModule = { createSkill, onInit };
registerSkillModule('杀', module_杀);
