// 连营(陆逊·被动技):当你失去最后的手牌时,你可以摸一张牌。
//
// 模式 A(被动触发):after hook 挂在「移动牌」「给予」「装备」「获得」「弃置」,
//   覆盖所有"手牌减少"的路径。
//   触发条件:本次 atom 使自己手牌区的牌减少,且 apply 后手牌数 == 0(失去最后的手牌)。
//   "你可以" → 询问确认(请求回应/连营/confirm),确认后摸一张牌。
//
// 关键点:
//   - "失去最后的手牌" = 本次操作移走了自己手牌区的牌,且手牌归零
//   - 移动牌/给予/装备:atom 字段(from.zone=手牌 / validate 保证 cardId 在 from 手牌)
//     即可判定确实移走了手牌 → after-hook 直接判定 hand.length===0
//   - 获得/弃置:可能作用于装备/判定区(非手牌),before-hook 记录"涉及手牌"标记,
//     after-hook 仅在标记存在时判定(避免手牌本就为 0、只丢装备时误触)
//   - 摸牌不减少手牌,不会自递归
//   - 牌堆+弃牌堆皆空时无法摸牌,提前跳过询问(摸牌 atom validate 会拦截)
//   - 无回合限制:自己回合内/外失去最后手牌均可触发
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const CONFIRM_RT = '连营/confirm';
const CONFIRMED_KEY = '连营/confirmed';
// 获得/弃置 before-hook 写入:标记本次 atom 涉及陆逊的手牌(值=before 手牌数,>=1)
const HAND_BEFORE_KEY = '连营/handBefore';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '连营',
    description: '被动技:当你失去最后的手牌时,你可以摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 触发:手牌归零 → 询问 → 摸牌。调用方已保证本次 atom 确实移走了陆逊的手牌。
  async function maybeTriggerLianYing(ctx: AtomAfterContext): Promise<void> {
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (self.hand.length !== 0) return; // 必须归零(失去最后的手牌)
    // 牌堆+弃牌堆皆空 → 无法摸牌,跳过询问
    if (ctx.state.zones.deck.length === 0 && ctx.state.zones.discardPile.length === 0) return;

    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动连营?(失去最后的手牌,摸一张牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  }

  // respond:回答连营询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是请求回应';
      if (atom.requestType !== CONFIRM_RT) return '当前不是连营确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 移动牌 after:从自己手牌区移走牌(打出/使用/被拆等) ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as {
      type?: string;
      from?: { zone?: string; player?: number };
      to?: { zone?: string; player?: number };
    };
    if (atom.type !== '移动牌') return;
    if (atom.from?.zone !== '手牌') return;
    if (atom.from?.player !== ownerId) return;
    // 移到自己手牌不算失去
    if (atom.to?.player === ownerId && atom.to?.zone === '手牌') return;
    await maybeTriggerLianYing(ctx);
  });

  // ── 给予 after:从自己手牌给他人(给予.validate 保证 cardId 在 from 手牌) ──
  registerAfterHook(state, skill.id, ownerId, '给予', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; from?: number; to?: number };
    if (atom.type !== '给予') return;
    if (atom.from !== ownerId) return;
    if (atom.to === ownerId) return; // 给自己不算失去
    await maybeTriggerLianYing(ctx);
  });

  // ── 装备 after:从手牌装备(装备.validate 保证 cardId 在手牌) ──
  registerAfterHook(state, skill.id, ownerId, '装备', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '装备') return;
    if (atom.player !== ownerId) return;
    await maybeTriggerLianYing(ctx);
  });

  // ── 获得 before+after:有人从陆逊获得牌 ──
  //   获得 可能作用于装备区(非手牌),before-hook 仅在涉及手牌时记录标记
  registerBeforeHook(state, skill.id, ownerId, '获得', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as {
      type?: string;
      from?: number;
      player?: number;
      cardId?: string;
    };
    if (atom.type !== '获得') return;
    if (atom.from !== ownerId) return;
    if (atom.player === ownerId) return;
    const hand = ctx.state.players[ownerId]?.hand ?? [];
    if (atom.cardId && hand.includes(atom.cardId)) {
      ctx.state.localVars[HAND_BEFORE_KEY] = hand.length;
    }
  });
  registerAfterHook(state, skill.id, ownerId, '获得', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; from?: number; player?: number };
    if (atom.type !== '获得') return;
    if (atom.from !== ownerId) return;
    if (atom.player === ownerId) return;
    const before = ctx.state.localVars[HAND_BEFORE_KEY];
    delete ctx.state.localVars[HAND_BEFORE_KEY];
    if (typeof before !== 'number') return; // 本次未涉及陆逊手牌
    await maybeTriggerLianYing(ctx);
  });

  // ── 弃置 before+after:陆逊被弃牌 ──
  //   弃置 可能作用于装备/判定区(非手牌),before-hook 仅在涉及手牌时记录标记
  registerBeforeHook(state, skill.id, ownerId, '弃置', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { type?: string; player?: number; cardIds?: string[] };
    if (atom.type !== '弃置') return;
    if (atom.player !== ownerId) return;
    const hand = ctx.state.players[ownerId]?.hand ?? [];
    if (atom.cardIds?.some((id) => hand.includes(id))) {
      ctx.state.localVars[HAND_BEFORE_KEY] = hand.length;
    }
  });
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '弃置') return;
    if (atom.player !== ownerId) return;
    const before = ctx.state.localVars[HAND_BEFORE_KEY];
    delete ctx.state.localVars[HAND_BEFORE_KEY];
    if (typeof before !== 'number') return; // 本次未涉及陆逊手牌
    await maybeTriggerLianYing(ctx);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '连营',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动连营?',
      confirmLabel: '发动(摸一张牌)',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
