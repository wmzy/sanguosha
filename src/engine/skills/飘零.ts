// 飘零(界小乔·被动技):结束阶段，你可以判定，若结果为红桃，
//   你将判定牌置于牌堆顶或交给一名角色，若该角色是你，你弃置一张牌。
//
// 官方来源:三国杀 OL 界限突破 hero/457(逐字):
//   "结束阶段，你可以判定，若结果为红桃，你将判定牌置于牌堆顶或交给一名角色，
//    若该角色是你，你弃置一张牌。"
//
// 时机:阶段开始(回合结束 = 结束阶段) after-hook。
// 流程:
//   1. 询问是否判定(confirm)
//   2. 判定{player=自己, judgeType='飘零'}(红颜/界红颜会把黑桃判定牌改为红桃)
//   3. 判定完成后,判定牌已在弃牌堆顶(判定 atom 的 def.afterHooks 已运行)
//   4. 读弃牌堆顶判定牌:非红桃 → 无效果;红桃 → 继续
//   5. 红桃:询问是否交给一名角色(confirm)
//        确认 → 选目标(choosePlayer,含自己)→ 移动牌(弃牌堆→目标手牌)
//               若目标==自己 → 弃一张手牌(useCard)
//        不确认 → 移动牌(弃牌堆→牌堆顶)
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_RT = '飘零/confirm';
const GIVE_RT = '飘零/give';
const TARGET_RT = '飘零/chooseTarget';
const DISCARD_RT = '飘零/discard';
const CONFIRMED_KEY = '飘零/confirmed';
const GIVE_KEY = '飘零/give';
const TARGET_KEY = '飘零/target';
const DISCARD_KEY = '飘零/discardCardId';

function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as Record<string, unknown>).requestType as string | undefined;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '飘零',
    description:
      '结束阶段可判定,红桃则将判定牌置牌堆顶或交给一名角色(给自己则弃一张牌)',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:飘零各询问的回应 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (
        rt !== CONFIRM_RT &&
        rt !== GIVE_RT &&
        rt !== TARGET_RT &&
        rt !== DISCARD_RT
      ) {
        return '当前不是飘零询问';
      }
      if (rt === TARGET_RT) {
        const target = params.target as number | undefined;
        if (typeof target !== 'number') return '请选择一名角色';
        if (!st.players[target]?.alive) return '目标无效';
        return null;
      }
      if (rt === DISCARD_RT) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张手牌弃置';
        const self = st.players[ownerId];
        if (!self?.hand.includes(cardId)) return '牌不在手牌中';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const rt = currentRequestType(st, ownerId);
      const confirmed = params.choice === true || params.confirmed === true;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = confirmed;
      } else if (rt === GIVE_RT) {
        st.localVars[GIVE_KEY] = confirmed;
      } else if (rt === TARGET_RT) {
        st.localVars[TARGET_KEY] = params.target ?? null;
      } else if (rt === DISCARD_RT) {
        st.localVars[DISCARD_KEY] = params.cardId ?? null;
      }
    },
  );

  // ── 阶段开始(回合结束 = 结束阶段) after-hook:飘零主流程 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '回合结束') return; // 结束阶段 = engine phase '回合结束'
    if (!ctx.state.players[ownerId]?.alive) return;
    if (ctx.state.zones.deck.length === 0) return; // 牌堆空:无法判定

    // 1. 询问是否判定
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动飘零判定?',
        confirmLabel: '判定',
        cancelLabel: '不判定',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 2. 判定
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '飘零' });

    // 3. 判定完成后,判定牌已在弃牌堆顶(判定 atom 的 def.afterHooks 已运行)
    const dp = ctx.state.zones.discardPile;
    if (dp.length === 0) return;
    const judgeCardId = dp[dp.length - 1];
    const card = ctx.state.cardMap[judgeCardId];
    // 非红桃:无效果
    if (card?.suit !== '♥') return;

    // 4. 红桃:询问是否交给一名角色(确认=交给,取消=置牌堆顶)
    delete ctx.state.localVars[GIVE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: GIVE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '飘零:将判定牌交给一名角色?(否则置于牌堆顶)',
        confirmLabel: '交给角色',
        cancelLabel: '置牌堆顶',
      },
      defaultChoice: false,
      timeout: 15,
    });
    const wantGive = ctx.state.localVars[GIVE_KEY] === true;
    delete ctx.state.localVars[GIVE_KEY];

    if (!wantGive) {
      // 置于牌堆顶:弃牌堆 → 牌堆
      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId: judgeCardId,
        from: { zone: '弃牌堆' },
        to: { zone: '牌堆' },
      });
      return;
    }

    // 5. 交给一名角色:选目标(含自己)
    delete ctx.state.localVars[TARGET_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '飘零:选择交给哪名角色',
        min: 1,
        max: 1,
        filter: (view, t) => view.players[t]?.alive === true,
      },
      timeout: 15,
    });
    const target = ctx.state.localVars[TARGET_KEY] as number | undefined;
    delete ctx.state.localVars[TARGET_KEY];
    if (typeof target !== 'number') {
      // 未选目标(超时)→ 兜底置牌堆顶,避免牌滞留弃牌堆
      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId: judgeCardId,
        from: { zone: '弃牌堆' },
        to: { zone: '牌堆' },
      });
      return;
    }
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;

    // 移动判定牌:弃牌堆 → 目标手牌
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: judgeCardId,
      from: { zone: '弃牌堆' },
      to: { zone: '手牌', player: target },
    });

    // 6. 若目标是自己:弃一张手牌
    if (target === ownerId) {
      const self = ctx.state.players[ownerId];
      if (!self?.alive || self.hand.length === 0) return;
      delete ctx.state.localVars[DISCARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: '飘零:弃置一张手牌',
          cardFilter: { filter: () => true, min: 1, max: 1 },
        },
        timeout: 15,
      });
      const discardCardId = ctx.state.localVars[DISCARD_KEY] as string | undefined;
      delete ctx.state.localVars[DISCARD_KEY];
      if (typeof discardCardId === 'string' && self.hand.includes(discardCardId)) {
        await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCardId] });
      }
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '飘零',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动飘零?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
