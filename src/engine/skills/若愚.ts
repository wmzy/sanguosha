// 若愚(刘禅·觉醒主公技):回合开始阶段,若你的体力是全场最少的(或之一),
// 你须增加1点体力上限并回复1点体力,然后永久获得技能"激将"。
//
// 分析(步骤1):
//   类型:主公技/觉醒技 | 时机:回合开始阶段(「回合开始」atom 的 after-hook)
//   触发条件:ownerId 是主公(ownerId===0) + 体力全场最少(或之一) + 未觉醒
//   流程(强制,无选择):
//     1. 增加1点体力上限(设上限 amount = maxHealth + 1)
//     2. 回复体力(此时上限已 +1,不会被旧上限 clamp;回复量为 0 则跳过)
//     3. 永久获得"激将"(添加技能 skillId='激将')
//   觉醒标记:player.vars['若愚/awakened']
//   主公判定: ownerId === 0(参考激将.ts 的 isLord 判断)
//
//   关键:增上限必须在回复前(先增加上限,再回复),否则回复被旧上限 clamp。
//   本文件同时导出 createAwakenLordSkill 工厂(觉醒主公技族共享实现),
//   界若愚 复用之,仅注入 name/description/awakenedKey/healAmount 差异参数。
import type { GameState, PlayerState, Skill } from '../types';
import { getHealthValue } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';

/** 觉醒主公技(若愚族)差异参数 */
export interface AwakenLordOptions {
  /** Skill.name(玩家可见技能名,标 '若愚' / 界 '界若愚') */
  name: string;
  description: string;
  /** 觉醒标记 vars 键(技能名/awakened 命名空间,标/界互相隔离) */
  awakenedKey: string;
  /** 增上限后计算的回复量;≤0 则跳过「回复体力」(标版恒 1,界版回复至 3) */
  healAmount: (self: PlayerState) => number;
}

/** 觉醒主公技共享实现:标版若愚与界若愚仅命名/文案/回复量不同,机制完全一致。 */
export function createAwakenLordSkill(opts: AwakenLordOptions) {
  return {
    createSkill(id: string, ownerId: number): Skill {
      return { id, ownerId, name: opts.name, description: opts.description };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
        const atom = ctx.atom;
        if (atom.player !== ownerId) return;
        // 觉醒技:整局一次
        if (ctx.state.players[ownerId]?.vars[opts.awakenedKey]) return;
        const self = ctx.state.players[ownerId];
        if (!self?.alive) return;
        // 主公判定: ownerId === 0(参考激将.ts)
        if (ownerId !== 0) return;

        // 体力全场最少(或之一):与所有存活玩家比较
        const alivePlayers = ctx.state.players.filter((p) => p.alive);
        if (alivePlayers.length === 0) return;
        const minHealth = Math.min(...alivePlayers.map((p) => getHealthValue(p)));
        if (getHealthValue(self) > minHealth) return;

        // 标记已觉醒(在读条件后立即设,防重入)
        ctx.state.players[ownerId].vars[opts.awakenedKey] = true;

        // 1. 增加1点体力上限
        await applyAtom(ctx.state, {
          type: '设上限',
          player: ownerId,
          amount: self.maxHealth + 1,
        });

        // 2. 回复体力(标版回复1点;界版回复至3点,已≥3 则回复量为 0 不回复)
        const healAmount = opts.healAmount(self);
        if (healAmount > 0) {
          await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: healAmount });
        }

        // 3. 永久获得"激将"
        await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '激将' });
      });

      return () => {};
    },

    onMount(): undefined {
      // 觉醒技,被动触发,无主动 action
      return undefined;
    },
  };
}

const OPTIONS: AwakenLordOptions = {
  name: '若愚',
  description: '主公技/觉醒技:回合开始且体力全场最少时,增加1体力上限、回复1体力并永久获得"激将"',
  awakenedKey: '若愚/awakened',
  healAmount: () => 1,
};

export const { createSkill, onInit, onMount } = createAwakenLordSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
