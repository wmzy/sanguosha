// src/engine/skills/酒.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   【酒】(基本牌,军争篇新增)——两种使用方法:
//     方法 Ⅰ(出牌阶段,每回合限一次):
//       - 目标:包括你在内的一名角色
//       - 效果:目标角色于此回合内使用的下一张【杀】的伤害值基数 +1
//       - 备注:判定的"下一张【杀】"按使用时机而定;非濒死时使用默认走方法 Ⅰ
//     方法 Ⅱ(濒死时):
//       - 目标:你
//       - 效果:你回复 1 点体力
//       - 备注:濒死时使用**不附加**伤害加成效果;处于濒死时使用默认走方法 Ⅱ
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
//   1. **缺失功能 1**:濒死时使用酒回复 1 体力(方法 Ⅱ)——当前完全没有此分支。
//   2. **drop + re-apply 反模式**:before hook 用 dropAtom + applyAtom 修改 amount,
//      会绕过其他 before hook 的执行(后注册的 hook 收到的是替换后的 atom,顺序敏感),
//      正确做法应是 mutate atom.amount(若类型允许)或走"伤害修正"统一管道。
//   3. **消耗时机不准**:mark 在"造成伤害"时消耗,但规则是"下次使用【杀】"——
//      若杀被闪闪掉(没造成伤害),mark 仍残留;下一张普通杀也会被错误增伤。
//      规则上酒应该在【杀】结算开始时(或使用时)消耗,而非伤害结算时。
//   4. **酒杀不应该叠加**:多次喝酒标准规则只生效最后一次,
//      当前 marks 是数组累加(reduce sum),理论上喝两次酒会让伤害 +2(违反规则)。
//   5. validate 未限制 target——方法 Ⅰ 允许任意角色,方法 Ⅱ 应限制 target === ownerId;
//      当前任何 target 都能传入(虽 UI 不暴露)。
//   6. 未在 onMount 注册 UI prompt——前端按钮如何触发未定义。
// ============================================================
import type { GameState, Atom, AtomBeforeContext, GameView, HookResult, Json, Skill  } from '../types';
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

  // respond:濒死求桃时,酒也可以当桃用(方法 Ⅱ)
  // 桃救援流程读 state.localVars['求桃/已救'] 来判断是否有人救援(见 runDyingFlow)。
  registerAction(skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      if (state.pendingSlot?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (state.pendingSlot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '求桃') return '当前不是求桃';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (card.name !== '酒') return '只能用酒救援';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: ownerId }, to: { zone: '弃牌堆' } });
      state.localVars['求桃/已救'] = true;
    },
  );

  // 消费 mark:在造成伤害时,如果是 self 造成的 且 有 酒/nextKillDamageBonus mark,amount + 1
  registerBeforeHook(skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
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