// 裸衣(许褚·主动技):摸牌阶段,你可以少摸一张牌,若如此做,
// 你使用【杀】或【决斗】造成的伤害 +1,直到下一回合开始。
//
// 机制:
//   - before hook 挂在「摸牌」:仅在自己摸牌阶段的摸牌(区分无中生有/遗计等)
//     询问是否发动。发动则 modify(count-1)并加增伤标签。
//   - before hook 挂在「造成伤害」:source=自己 + 增伤标签 + 牌为杀/决斗 → modify(amount+1)。
//   - after hook 挂在「回合开始」:下一回合开始时清除增伤标签(直到下一回合开始)。
//   - 每回合限一次:裸衣/usedThisTurn(后缀约定,回合结束 atom 自动清空)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const BONUS_TAG = '裸衣/bonus';
const CONFIRM_REQUEST = '裸衣/confirm';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '裸衣',
    description: '摸牌阶段少摸一张,本回合杀/决斗伤害 +1,直到下一回合开始',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── confirm respond:许褚本人回应是否发动裸衣 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CONFIRM_REQUEST) return '当前不是裸衣确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars['裸衣/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 摸牌 before hook:摸牌阶段询问,发动则少摸一张 + 加增伤标签 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number; count?: number };
      // 仅自己回合的摸牌阶段(排除无中生有/遗计/激将等其他摸牌)
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      if (ctx.state.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (self.vars['裸衣/usedThisTurn']) return; // 本回合已发动

      // 询问是否发动
      delete ctx.state.localVars['裸衣/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动裸衣?(少摸一张牌,杀/决斗伤害 +1)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars['裸衣/confirmed']) return;

      // 发动:同步设限一次标记(防 dispatch 重入),加增伤标签,modify 少摸一张
      self.vars['裸衣/usedThisTurn'] = true;
      await applyAtom(ctx.state, {
        type: '回合用量',
        player: ownerId,
        key: '裸衣/usedThisTurn',
        value: true,
      });
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: BONUS_TAG });
      const count = atom.count ?? 2;
      return { kind: 'modify', atom: { ...ctx.atom, count: Math.max(0, count - 1) } as typeof ctx.atom };
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
      return { kind: 'modify', atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom };
    },
  );

  // ── 回合开始 after hook:下一回合开始时清除增伤标签 ──
  // 许褚摸牌阶段设标签 → 持续到下一个回合开始(任意玩家的回合开始)清除。
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx: AtomAfterContext) => {
    const self = ctx.state.players[ownerId];
    if (self?.tags.includes(BONUS_TAG)) {
      await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: BONUS_TAG });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '裸衣',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动裸衣?(少摸一张牌,杀/决斗伤害 +1)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
