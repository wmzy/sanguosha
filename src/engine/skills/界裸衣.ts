// 界裸衣(界许褚·魏·主动技):出牌阶段,你可以弃置一张牌,然后本回合你使用【杀】
// 或【决斗】造成的伤害 +1。每回合限一次。
//
// 界版变化(相对标版裸衣 src/engine/skills/裸衣.ts):
//   - 触发时机:摸牌阶段 → 出牌阶段(改为主动 use action)。
//   - 触发方式:少摸一张牌 → 弃置一张牌(手牌或装备区)。
//   - 持续时间:直到下一回合开始 → 本回合(回合结束时清增伤标签)。
//
// 机制:
//   - use action(注册在 ownerId 座次):出牌阶段弃置一张牌(代价)→ 加增伤标签。限一次/回合。
//   - 造成伤害 before hook:source=自己 + 增伤标签 + 牌为杀/决斗 → modify(amount+1)。
//   - 回合结束 after hook:本玩家回合结束时清除增伤标签(实现"本回合"生效)。
//   - 每回合限一次:裸衣/usedThisTurn(后缀约定,回合结束 atom 自动清空)。
//   - 内部标签/localVars/requestType 键名保持原前缀 '裸衣/xxx'(界版规范)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  EquipSlot,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, registerAfterHook, registerBeforeHook, hasBlockingPending } from '../skill';

const BONUS_TAG = '裸衣/bonus';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界裸衣',
    description: '出牌阶段弃置一张牌,本回合使用杀或决斗伤害 +1,每回合限一次',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:出牌阶段弃牌(代价)+ 加增伤标签 ──────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>) => {
      const self = st.players[ownerId];
      if (!self) return 'player not found';
      if (!self.alive) return '你已死亡';
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, '裸衣')) return '本回合已使用过裸衣';
      // 代价牌:手牌或装备区一张牌(兼容 cardIds 数组与单数 cardId)
      const cardIds =
        (params.cardIds as string[] | undefined) ??
        (typeof params.cardId === 'string' ? [params.cardId] : undefined);
      if (!Array.isArray(cardIds) || cardIds.length !== 1) return '请选择一张要弃置的牌';
      const cardId = cardIds[0];
      const inHand = self.hand.includes(cardId);
      const inEquip = Object.values(self.equipment).includes(cardId);
      if (!inHand && !inEquip) return '弃置的牌必须在手牌或装备区中';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      // 兼容 cardIds 数组与单数 cardId(与 validate 一致)
      const cardIds =
        (params.cardIds as string[] | undefined) ??
        (typeof params.cardId === 'string' ? [params.cardId] : []);
      const costCardId = cardIds[0];

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入,见制衡.ts 注释)
      await markOncePerTurn(st, from, '裸衣');

      await pushFrame(st, '界裸衣', from, { ...params });

      // 弃置代价牌:装备区牌先卸下(清武器距离 vars + 回手),再弃置;手牌直接弃置。
      // 镜像强袭.ts 的装备代价模式:弃置 atom 不清 距离/出杀范围 vars,须经 卸下 清除。
      const equipSlotEntry = Object.entries(st.players[from].equipment).find(
        ([, id]) => id === costCardId,
      );
      if (equipSlotEntry) {
        await applyAtom(st, { type: '卸下', player: from, slot: equipSlotEntry[0] as EquipSlot });
      }
      await applyAtom(st, { type: '弃置', player: from, cardIds: [costCardId] });

      // 加增伤标签:本回合杀/决斗伤害 +1(回合结束时清)
      await applyAtom(st, { type: '加标签', player: from, tag: BONUS_TAG });

      await popFrame(st);
    },
  );

  // ── 造成伤害 before hook:杀/决斗伤害 +1 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { source?: number; amount?: number; cardId?: string };
      if (atom.source !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(BONUS_TAG)) return;
      const cardId = atom.cardId;
      if (typeof cardId !== 'string') return;
      const card = ctx.state.cardMap[cardId];
      if (!card) return;
      if (card.name !== '杀' && card.name !== '决斗') return;
      return {
        kind: 'modify',
        atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom,
      };
    },
  );

  // ── 回合结束 after hook:本玩家回合结束时清除增伤标签("本回合"生效)──
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (self?.tags.includes(BONUS_TAG)) {
      await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: BONUS_TAG });
    }
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '界裸衣',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'select',
      title: '界裸衣:选择一张牌弃置(本回合杀/决斗伤害 +1)',
      source: 'handAndEquip',
      minTotal: 1,
      maxTotal: 1,
    },
    activeWhen: (ctx) => {
      if (!activeUnlessUsedThisTurn('裸衣')(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      const hasHand = (p.hand?.length ?? 0) > 0;
      const hasEquip = Object.values(p.equipment ?? {}).some((id) => !!id);
      return hasHand || hasEquip;
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
