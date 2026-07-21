// 空城(诸葛亮·锁定技):若你没有手牌,你不是【杀】和【决斗】的合法目标。
//
// 实现:before-hook 挂「成为目标」(结算阶段第一个 atom)。
//   成为目标 atom 注释明确支持"不能成为目标"类技能(空城/帷幕)在 before 阶段 cancel。
//   当 target===owner 且 owner 无手牌,且当前结算的牌是 杀 或 决斗 时,cancel 该目标。
//   杀.use / 决斗.use 检测 成为目标 返回 false(cancel)后跳过该目标的结算。
//
// 判定"杀/决斗":优先看 atom.cardId 对应卡牌名;无 cardId(虚拟杀等)时回退看栈顶帧 skillId。
// 备注(规则):已被杀指定为目标后再失去手牌,不影响该杀的结算——本实现因挂在"成为目标"
//   (结算阶段入口)天然满足:此时手牌状态即结算时状态。
import type { AtomBeforeContext, HookResult, Skill, GameState } from '../types';
import { topFrame } from '../create-engine';
import { registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '空城',
    description: '锁定技:若你没有手牌,你不是杀和决斗的合法目标',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerBeforeHook(
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
  return () => {};
}

export default { createSkill, onInit };
