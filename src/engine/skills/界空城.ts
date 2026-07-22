// 界空城(界诸葛亮·锁定技):若你没有手牌,你不是【杀】和【决斗】的合法目标;
// 你使用的【杀】被【闪】抵消后,可以摸一张牌。
//
// 实现:
//   1. before-hook 挂「成为目标」(结算阶段第一个 atom):
//      当 target===owner 且 owner 无手牌,且当前结算的牌是 杀 或 决斗 时,cancel 该目标。
//      杀.use / 决斗.use 检测 成为目标 返回 false(cancel)后跳过该目标的结算。
//      判定"杀/决斗":优先看 atom.cardId 对应卡牌名;无 cardId(虚拟杀等)时回退看栈顶帧 skillId。
//      备注(规则):已被杀指定为目标后再失去手牌,不影响该杀的结算——本实现因挂在"成为目标"
//      (结算阶段入口)天然满足:此时手牌状态即结算时状态。
//
//   2. after-hook 挂「被抵消」:检测自己使用的杀被闪抵消 → 摸一张牌。
//      实现模式与界张飞咆哮(界咆哮.ts)完全一致。
import type { AtomAfterContext, AtomBeforeContext, HookResult, Skill, GameState } from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAfterHook, registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界空城',
    description: '锁定技:若你没有手牌,你不是杀和决斗的合法目标;你使用的杀被闪抵消后摸一张牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // before-hook:无手牌时不能成为 杀/决斗 的目标
  const unregBefore = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '成为目标',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number; cardId?: string };
      if (atom.target !== ownerId) return;
      // 只有无手牌时生效
      if (ctx.state.players[ownerId]?.hand.length !== 0) return;

      // 判定当前结算的牌是否为 杀 或 决斗
      let cardName: string | undefined;
      if (atom.cardId) {
        cardName = ctx.state.cardMap[atom.cardId]?.name;
      }
      if (!cardName) {
        // 无 cardId(虚拟杀等):看栈顶结算帧的技能名
        const frame = topFrame(ctx.state);
        cardName = frame?.skillId;
      }
      if (cardName !== '杀' && cardName !== '决斗') return;

      // 无手牌 → 不是合法目标 → cancel(杀/决斗跳过此目标结算)
      return { kind: 'cancel' };
    },
  );

  // 杀被闪抵消后摸一张牌(与界张飞咆哮同款 after hook)
  const unregAfter = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '被抵消',
    async (ctx: AtomAfterContext) => {
      // 只对杀生效:万箭齐发等锦囊被闪抵消不触发(贯石斧/青龙/咆哮同款判断)
      if (ctx.frame.skillId !== '杀') return;
      const atom = ctx.atom as { source?: number; target?: number };
      // 只在"自己使用的杀"被抵消时触发
      if (atom.source !== ownerId) return;
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    },
  );

  return () => {
    unregBefore();
    unregAfter();
  };
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
