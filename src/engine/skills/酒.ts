// src/engine/skills/酒.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   【酒】(基本牌,军争篇新增):
//     - 对自己使用(出牌阶段):
//       - 对自己使用后,本回合你使用的**下一张【杀】**伤害 +1
//       - **每回合只能使用 1 次【酒】**(提升杀伤害)
//     - 濒死时对他人使用:
//       - 当一名角色处于濒死状态时,你可以对其使用【酒】回复 1 点体力
//       - 濒死时使用**不附加**伤害加成效果
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) → 加标记(酒/nextKillDamageBonus payload=1, duration=turn) →
//     移动牌(处理区→弃牌堆) → popFrame
//   before 钩子(造成伤害):
//     若 source===ownerId 且持有 mark → dropAtom + applyAtom(amount+1) + 去标记
//
// 关键时机:
//   - mark 的 duration='turn'——回合结束自动清理(若未消耗)
//   - 仅消耗:在【杀】造成伤害前增伤,通过 before hook 替换 atom
//
// 已知问题/不完整实现:
//   1. **缺失功能 1**:濒死时使用酒回复 1 体力(标准规则)——当前完全没有此分支。
//   2. **drop + re-apply 反模式**:before hook 用 dropAtom + applyAtom 修改 amount,
//      会绕过其他 before hook 的执行(后注册的 hook 收到的是替换后的 atom,顺序敏感),
//      正确做法应是 mutate atom.amount(若类型允许)或走"伤害修正"统一管道。
//   3. **消耗时机不准**:mark 在"造成伤害"时消耗,但规则是"下次使用【杀】"——
//      若杀被闪闪掉(没造成伤害),mark 仍残留;下一张普通杀也会被错误增伤。
//      规则上酒应该在【杀】结算开始时(或使用时)消耗,而非伤害结算时。
//   4. **酒杀不应该叠加**:多次喝酒标准规则只生效最后一次,
//      当前 marks 是数组累加(reduce sum),理论上喝两次酒会让伤害 +2(违反规则)。
//   5. validate 未限制 target 必须是自己——任何 target 都能传入(虽 UI 不暴露)。
//   6. 未在 onMount 注册 UI prompt——前端按钮如何触发未定义。
// ============================================================
import type { GameState, Atom, AtomBeforeContext, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '酒', description: '出牌阶段对自己使用,本回合下一张杀的伤害+1' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      // 酒只能对自己用;但 params 不传 target(默认 from)
      // 由 action 路由层保证 from === ownerId
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      const frame = pushFrame(state, '酒', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      await applyAtom(state, {
        type: '加标记',
        player: from,
        mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
      });
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      popFrame(state);
    }, );

  // 消费 mark:在造成伤害时,如果是 self 造成的 且 有 酒/nextKillDamageBonus mark,amount + 1
  registerBeforeHook(skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<{ kind: 'modify' } | void> => {
    const atom = ctx.atom as { source?: number; amount?: number; type: string };
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const hasMark = self.marks.some(m => m.id === '酒/nextKillDamageBonus');
    if (!hasMark) return;
    // 先消费 mark(副作用),再 modify 伤害 +1
    await applyAtom(ctx.state, { type: '去标记', player: ownerId, markId: '酒/nextKillDamageBonus' });
    return { kind: 'modify', atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom };
  });

  return () => {};
}

export default { createSkill, onInit };