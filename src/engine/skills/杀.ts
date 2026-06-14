// src/engine/skills/杀.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   【杀】(基本牌):
//     - 使用条件:出牌阶段 / 必须对攻击范围内的角色使用(初始攻击范围 1,装备武器后按武器范围)
//     - 目标限制:攻击范围内的 1 名角色(可以是自己,但通常无意义)
//     - 效果:目标角色须使用 1 张【闪】来抵消,否则受到 1 点伤害
//     - 限制:每回合默认只能使用 1 张【杀】(装备诸葛连弩除外)
//     - 备注:使用【杀】时可能触发武器的特殊效果(青釭剑无视防具、雌雄双股剑等)
//
// 关键原子操作:
//   use 路径:
//     移动牌(手牌→处理区) → 指定目标 → 询问闪 → 造成伤害 → 移动牌(处理区→弃牌堆) → 加标记(killsPlayed)
//   respond 路径(决斗/南蛮入侵/万箭齐发/激将等场景):
//     移动牌(手牌→弃牌堆) → mutate parent frame.settlement.responded/dodged
//
// 关键时机:
//   - validate:出杀次数(killsPlayed mark)、攻击范围(距离 + 武器)
//   - 询问闪 是等待型 atom,挂起 execute 直到目标回应或超时(15s)
//
// 已知问题/不完整实现:
//   1. validate 未限制"其他角色"(理论上当前可对自己出杀,虽 UI 不显示)
//   2. WEAPON_RANGE 表与 src/engine/distance.ts 完全重复——应直接调用
//      inAttackRange(state, from, to) 复用,而非内联硬编码武器列表。
//   3. 距离计算硬编码进攻马/防御马,未走"距离技能" hook,无法被新技能(如马术)修正。
//   4. 未考虑杀属性(普通/火杀/雷杀)——红色 → 火,黑色 → 雷,无属性区分对应防具(藤甲等)。
//   5. "诸葛连弩"判定通过 marks 名 '诸葛连弩/无限出杀' 硬耦合;新增类似无限出杀效果需复制此分支。
//   6. respond 用 frame.params.__杀响应 / __responded 等私有标签 mutate parent frame,
//      属于"通过 params 传递跨 atom 状态"的反模式(类型注释明确说明应通过 state 观察)。
//   7. settlement.dodged 既表示"出闪了"也表示"出杀响应了决斗"——语义模糊,应拆分字段。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame, topFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '杀', description: '出牌阶段对攻击范围内一名角色使用' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length === 0) return 'targets required';
      const self = state.players[ownerId];
      const killsPlayed = self.marks
        .filter(m => m.id === '杀/killsPlayed')
        .reduce((n, m) => n + (typeof m.payload === 'number' ? m.payload : 0), 0);
      const hasUnlimitedKills = self.marks.some(m => m.id === '诸葛连弩/无限出杀');
      if (killsPlayed >= 1 && !hasUnlimitedKills) return '出杀次数已用尽';
      // 距离检查:目标必须在攻击范围内
      const WEAPON_RANGE: Record<string, number> = {
        '诸葛连弩': 1, '青釭剑': 2, '雌雄双股剑': 2, '贯石斧': 3,
        '青龙偃月刀': 3, '丈八蛇矛': 3, '方天画戟': 4, '麒麟弓': 5, '寒冰剑': 2,
      };
      let range = 1;
      const weaponId = self.equipment?.['武器'];
      if (weaponId) {
        const weapon = state.cardMap[weaponId];
        if (weapon) range = WEAPON_RANGE[weapon.name] ?? 1;
      }
      const alive = state.players.filter(p => p.alive);
      const aliveSelfIdx = alive.findIndex(p => p.index === ownerId);
      for (const targetIdx of targets) {
        const aliveToIdx = alive.findIndex(p => p.index === targetIdx);
        if (aliveToIdx < 0) return `target ${targetIdx} not found`;
        const n = alive.length;
        const d = Math.abs(aliveSelfIdx - aliveToIdx);
        let dist = Math.min(d, n - d);
        if (self.equipment?.['进攻马']) dist -= 1;
        const targetPlayer = state.players[targetIdx];
        if (targetPlayer?.equipment?.['防御马']) dist += 1;
        dist = Math.max(1, dist);
        if (dist > range) return `目标 ${targetIdx} 不在攻击范围内(距离${dist},范围${range})`;
      }
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      const cardId = params.cardId as string;
      const targets = params.targets as number[];
      const frame = pushFrame(state, '杀', from, { ...params });
      frame.params.settlement = targets.map(t => ({ target: t, dodged: false }));
      frame.params.cardId = cardId;
      // 移动杀到处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      // 询问闪挂起 → 玩家回应后 Promise resolve → 自然续跑
      for (const target of targets) {
        await applyAtom(state, { type: '指定目标', source: from, target });
        await applyAtom(state, { type: '询问闪', target, source: from });
      }
      // 对未闪避的目标造成伤害
      const settlement = frame.params.settlement as Array<{ target: number; dodged: boolean }>;
      for (const item of settlement) {
        if (!item.dodged) {
          await applyAtom(state, { type: '造成伤害', target: item.target, amount: 1, source: from });
        }
      }
      // 移动杀到弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      // 记录出杀次数(duration='turn' 在回合结束时自动清理)
      await applyAtom(state, {
        type: '加标记',
        player: from,
        mark: { id: '杀/killsPlayed', scope: -1, payload: 1, duration: 'turn' },
      });
      popFrame(state);
    }, );
  // respond action:南蛮入侵/决斗/万箭齐发/激将等场景,目标"出杀抵消"
  // 通过 parent frame 的 params.settlement 标记 responded = true
  registerAction(skill.id, ownerId, 'respond', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      const cardId = params.cardId as string;
      // 移动杀到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '弃牌堆' } });
      // 在当前帧(南蛮入侵/决斗帧)的 settlement 中标记 responded
      const frame = topFrame(state);
      if (frame) {
        const settlement = frame.params.settlement as Array<{ target: number; responded?: boolean; dodged?: boolean }> | undefined;
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
    }, );
  return () => {};
}

export default { createSkill, onInit };
