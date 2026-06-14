// src/engine/skills/决斗.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   决斗(普通锦囊):出牌阶段,对一名其他角色使用。
//   目标先开始,与使用者轮流弃置(规则上是出杀,本质是弃杀的语义)一张【杀】,
//   首先不弃【杀】的一方受到对方造成的 1 点伤害。
//   可被【无懈可击】取消。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) →
//     loop:
//       询问杀(current, source=对方) →
//       读 frame.params.__决斗回应 → 若未回应则 loser=current,跳出
//                                  → 若回应则切换 turn
//     造成伤害(loser, amount=1, source=winner) → 移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 目标先出杀(turn=0),然后使用者(turn=1),轮流直到一方放弃
//   - 询问杀 等待型 atom,玩家回应/超时后通过 frame.params.__决斗回应 标记
//
// 已知问题/不完整实现:
//   1. **__决斗回应 标记永不清理**:每轮询问后读 `__决斗回应`,但代码从未把它重置为 undefined——
//      若目标第一次回应 true,after 第二轮发起者没回应(timeout),`__决斗回应` 还是 true,
//      循环错误地切到目标的回合,死循环或胜负判断错误!
//      正确应每次询问前 reset,或用 ctx.params 拉取本次结果。
//   2. **无懈可击未支持**:整个 use 流程没有"询问无懈"环节。
//   3. **激将未支持**:目标/使用者是主公时,蜀势力可代出杀——本文件无此 hook。
//   4. **__决斗回应 单字段不区分是谁回应**:决斗有两个角色,需独立追踪——
//      当前 mutate 同一字段,杀.ts respond 写谁的回应都会覆盖。
//   5. **使用者伤害来源**:loser=target 时 winner=from(正确),
//      loser=from 时 winner=target——但 target 是"被使用者动用的角色",
//      target 对 from 造成伤害属于"反向伤害",反馈/护甲等技能此时会按对方为伤害来源触发,符合规则。
//   6. validate 不验证 target 是其他角色(允许对自己决斗,违反规则)。
//   7. validate 不验证 cardId 在手牌中。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '决斗', description: '对一名角色使用,双方轮流出杀,先不出者受 1 点伤害' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'number') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as number;
      const frame = pushFrame(state, '决斗', from, { ...params });

      // 移牌到处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // ─── Promise-based 续跑 ───
      // 决斗循环:目标先出杀,之后发起者出杀,轮流
      let turn = 0; // 0=目标, 1=发起者
      let loser: number | null = null;
      while (loser === null) {
        const current = turn === 0 ? target : from;
        await applyAtom(state, { type: '询问杀', target: current, source: turn === 0 ? from : target });
        // 询问杀挂起 → resolve 后读取回应
        const responded = frame.params.__决斗回应 as boolean | undefined;
        if (!responded) {
          loser = current;
        } else {
          turn = turn === 0 ? 1 : 0;
        }
      }
      const winner = loser === target ? from : target;
      await applyAtom(state, { type: '造成伤害', target: loser, amount: 1, source: winner });
      // 移牌到弃牌堆
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