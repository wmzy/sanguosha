// src/engine/skills/仁德.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   仁德(刘备):出牌阶段,你可以将一张手牌交给其他角色,你以此法首次给出累计两张牌后,
//   你回复 1 点体力。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → for each target/cardId: 移动牌(手牌→目标手牌) → 若 total≥2 且本回合未回血: 回复体力
//     popFrame
//
// 关键时机:
//   - 出牌阶段使用,不限次数(但回血每回合限一次)
//   - "累计两张"是回合内累计,标准规则是首次累计达到 2 张时回血
//
// 已知问题/不完整实现:
//   1. **描述/实现偏离规则**:标准规则是"每次给一张"(动作粒度=一张),回合内累计;
//      当前实现允许"一次批量给多张到多个目标",虽达到同样累计,但 UI 交互与事件粒度不符标准。
//   2. **回血累计错误作用域**:`healed` 标志存在 `frame.params['仁德/healedThisTurn']`——
//      frame 是 execute 局部,每次 use 重新 push,所以同回合内多次 use 会重复回血!
//      应该写入 `player.vars['仁德/healedThisTurn']`(回合结束清理)。
//   3. validate 未检查 target 必须是"其他角色"(理论上可给自己 → 自抽,违反规则)。
//   4. validate 未检查 cardIds 是否真在 from 手牌中(防御缺失,可能给出装备/不存在的牌)。
//   5. validate 未检查 target 是否存活。
// ============================================================
import type { GameState, FrontendAPI, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '仁德',
    description: '出牌阶段,可以将任意数量手牌给其他角色;给出 ≥2 张后回复 1 体力',
  };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const targets = params.targets as Array<{ target: string; cardIds: string[] }> | undefined;
      if (!Array.isArray(targets) || targets.length === 0) return 'targets required';
      const total = targets.reduce((n, t) => n + (Array.isArray(t.cardIds) ? t.cardIds.length : 0), 0);
      if (total === 0) return 'no cards to give';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const frame = pushFrame(state, '仁德', from, { ...params });
      const targets = params.targets as Array<{ target: string; cardIds: string[] }>;
      for (const t of targets) {
        for (const cardId of t.cardIds) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '手牌', player: t.target } });
        }
      }
      const total = targets.reduce((n, t) => n + t.cardIds.length, 0);
      if (total >= 2) {
        const healed = frame.params['仁德/healedThisTurn'] as boolean | undefined;
        if (!healed) {
          await applyAtom(state, { type: '回复体力', target: from, amount: 1 });
          frame.params['仁德/healedThisTurn'] = true;
        }
      }
      popFrame(state);
    }, );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '仁德',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '仁德：选择要送出的手牌和目标角色',
      cardFilter: { min: 1, max: 99 },
      targetFilter: { min: 1, max: 1 },
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount };
