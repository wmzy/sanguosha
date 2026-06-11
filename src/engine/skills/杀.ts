// src/engine/skills/杀.ts
// 杀:出牌阶段对攻击范围内一名角色使用,目标可出闪
// 计数:持久化到 player.marks(每回合 turn 结束自动清理)
import type { BackendAPI, GameView, Json, EngineApi, Skill } from '../types';
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
    async (api: EngineApi) => {
      const from = api.self;
      const params = api.params;
      const cardId = params.cardId as string;
      const targets = params.targets as string[];
      const frame = api.pushFrame('杀', from, { ...params });
      frame.params.settlement = targets.map(t => ({ target: t, dodged: false }));
      frame.params.cardId = cardId;
      // 移动杀到处理区
      await api.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      // 询问闪挂起 → 玩家回应后 Promise resolve → 自然续跑
      for (const target of targets) {
        await api.apply({ type: '指定目标', source: from, target });
        await api.apply({ type: '询问闪', target, source: from });
      }
      // 对未闪避的目标造成伤害
      const settlement = frame.params.settlement as Array<{ target: string; dodged: boolean }>;
      for (const item of settlement) {
        if (!item.dodged) {
          await api.apply({ type: '造成伤害', target: item.target, amount: 1, source: from });
        }
      }
      // 移动杀到弃牌堆
      await api.apply({
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      // 记录出杀次数(duration='turn' 在回合结束时自动清理)
      await api.apply({
        type: '加标记',
        player: from,
        mark: { id: '杀/killsPlayed', scope: -1, payload: 1, duration: 'turn' },
      });
    },
  );
  // respond action:南蛮入侵/决斗/万箭齐发/激将等场景,目标"出杀抵消"
  // 通过 parent frame 的 params.settlement 标记 responded = true
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
      // 移动杀到弃牌堆
      await api.apply({ type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '弃牌堆' } });
      // 在当前帧(南蛮入侵/决斗帧)的 settlement 中标记 responded
      const frame = api.topFrame();
      if (frame) {
        const settlement = frame.params.settlement as Array<{ target: string; responded?: boolean; dodged?: boolean }> | undefined;
        if (settlement) {
          const item = settlement.find(s => s.target === from);
          if (item) {
            item.responded = true;
            item.dodged = true;
          }
        }
        frame.params.__杀响应 = true;
        frame.params.__responded = from;
      }
    },
  );
  return () => {};
}

export const module_杀: SkillModule = { createSkill, onInit };
registerSkillModule('杀', module_杀);
