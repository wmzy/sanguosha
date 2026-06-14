// src/engine/skills/桃.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   【桃】(基本牌):
//     - 对自己使用:
//       - 出牌阶段,对自己使用
//       - 回复 1 点体力
//       - **体力已满时不能对自己使用**
//     - 对他人使用:
//       - 当其他角色处于濒死状态时,你可以对其使用【桃】
//       - 回复 1 点体力(不限制体力上限?实际是 +1 后才检上限)
//     - 备注:响应濒死时是即时使用,不受出牌阶段限制
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) → 回复体力 → 移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 出牌阶段:target 必须是自己,且自己体力 < 上限
//   - 濒死求桃:在 dyingWindow pending 期间,任何角色都可对濒死角色使用桃
//
// 已知问题/不完整实现:
//   1. validate 只检查 target 存在,未限制"出牌阶段时只能对自己使用",
//      也未检查"濒死阶段才允许对其他玩家使用"——
//      理论上当前允许出牌阶段对任意人使用桃(违反规则)。
//   2. validate 未检查目标体力是否 < 上限——空回血(满血时)可能被错误允许,
//      会浪费一张桃且产生噪音事件(虽然 回复体力 atom 内可能限制)。
//   3. 缺少濒死场景的特殊处理:当前实现走的是普通 use 流程,
//      与 dyingWindow pending 的交互(中断 wait、注入回应)未在本文件体现,需检查 dispatch 路径。
//   4. 没有 onMount 注册 UI prompt——前端如何区分"出牌阶段桃"与"濒死求桃"二者的目标选择,
//      需依赖外部 prompt 配置(如 dyingWindow PendingAction 自带 target 列表)。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '桃', description: '出牌阶段对自己使用,回复 1 体力(濒死时可对任何濒死角色使用)' };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const target = (params.target ?? (params.targets as string[] | undefined)?.[0]) as string | undefined;
      if (!target) return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const frame = pushFrame(state, '桃', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.target ?? (params.targets as string[] | undefined)?.[0]) as string;
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      await applyAtom(state, { type: '回复体力', target, amount: 1, source: from });
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
