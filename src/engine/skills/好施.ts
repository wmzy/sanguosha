// 好施(鲁肃·吴·主动技):摸牌阶段，你可以额外摸两张牌，
// 若此时你的手牌数超过五张，你必须将一半（向下取整）的手牌
// 交给除你外手牌数最少的一名角色。
//
// 机制(镜像英姿,但 +2 且触发强制给牌):
//   - before hook 挂在「摸牌」:仅在自己摸牌阶段的摸牌(区分无中生有/遗计等)
//     询问是否发动。发动则 modify(count+2),并设 ACTIVE 标记。
//   - after hook 挂在「摸牌」:若 ACTIVE 标记存在且手牌 > 5,
//     找到除自己外手牌最少的存活角色(并列则询问选择),
//     询问鲁肃选择 floor(handCount/2) 张牌给予该角色(给予 atom)。
//   - 每回合限一次:好施/usedThisTurn 防重入,由「回合结束」atom 自动清空。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameView,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';
import {
  registerAction,
  registerBeforeHook,
  registerAfterHook,
  type SkillModule,
} from '../skill';

const CONFIRM_RT = '好施/confirm'; // 鲁肃:是否发动好施
const CHOOSE_TARGET_RT = '好施/target'; // 鲁肃:并列时选目标
const GIVE_RT = '好施/give'; // 鲁肃:选牌给出
const CONFIRMED_KEY = '好施/confirmed';
const ACTIVE_KEY = '好施/active'; // before 设,after 读,确保仅对好施的摸牌生效
const TARGET_KEY = '好施/chosenTarget';
const GIVE_KEY = '好施/giveCards';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '好施',
    description:
      '摸牌阶段，你可以额外摸两张牌，若此时你的手牌数超过五张，你必须将一半（向下取整）的手牌交给除你外手牌数最少的一名角色',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond action:处理 confirm/target/give 三种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== CHOOSE_TARGET_RT && rt !== GIVE_RT) {
        return '当前不是好施询问';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === CHOOSE_TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? (params.target) : undefined);
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
      } else if (rt === GIVE_RT) {
        const ids = params.cardIds as string[] | undefined;
        if (Array.isArray(ids)) st.localVars[GIVE_KEY] = ids;
      }
    },
  );

  // ── 摸牌 before hook:摸牌阶段询问,发动则额外摸两张 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number; count?: number };
      // 仅自己回合的摸牌阶段(排除无中生有/遗计/苦肉等其他摸牌)
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      if (ctx.state.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (usedThisTurn(ctx.state, ownerId, '好施')) return; // 本回合已发动

      // 询问是否发动
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动好施?(额外摸两张牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return;

      // 发动:限一次标记 + ACTIVE 标记(防 dispatch 重入)
      await markOncePerTurn(ctx.state, ownerId, '好施');
      ctx.state.localVars[ACTIVE_KEY] = true;

      const count = atom.count ?? 2;
      return { kind: 'modify', atom: { ...ctx.atom, count: count + 2 } as typeof ctx.atom };
    },
  );

  // ── 摸牌 after hook:若手牌 > 5,给牌给手牌最少的角色 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx: AtomAfterContext): Promise<void> => {
      const atom = ctx.atom as { player?: number };
      if (atom.player !== ownerId) return;
      if (!ctx.state.localVars[ACTIVE_KEY]) return;
      delete ctx.state.localVars[ACTIVE_KEY];

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      const handCount = self.hand.length;
      if (handCount <= 5) return; // 不超过五张,无需给牌

      const giveCount = Math.floor(handCount / 2);

      // 找除自己外手牌最少的存活角色
      let minCount = Infinity;
      const candidates: number[] = [];
      for (const p of ctx.state.players) {
        if (p.index === ownerId || !p.alive) continue;
        if (p.hand.length < minCount) {
          minCount = p.hand.length;
          candidates.length = 0;
          candidates.push(p.index);
        } else if (p.hand.length === minCount) {
          candidates.push(p.index);
        }
      }
      if (candidates.length === 0) return;

      let target: number;
      if (candidates.length === 1) {
        target = candidates[0];
      } else {
        // 并列:询问鲁肃选择
        delete ctx.state.localVars[TARGET_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: CHOOSE_TARGET_RT,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title: '好施:选择手牌最少的角色(给予手牌)',
            min: 1,
            max: 1,
            filter: (_view: GameView, t: number) => candidates.includes(t),
          },
          timeout: 15,
        });
        const chosen = ctx.state.localVars[TARGET_KEY] as number | undefined;
        delete ctx.state.localVars[TARGET_KEY];
        if (typeof chosen !== 'number') return;
        target = chosen;
      }

      // 询问鲁肃选择 giveCount 张牌给出
      delete ctx.state.localVars[GIVE_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: GIVE_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: `好施:选择 ${giveCount} 张牌交给 ${ctx.state.players[target].name}`,
          cardFilter: { filter: () => true, min: giveCount, max: giveCount },
        },
        timeout: 30,
      });
      const giveCards = ctx.state.localVars[GIVE_KEY] as string[] | undefined;
      delete ctx.state.localVars[GIVE_KEY];
      if (giveCards && giveCards.length > 0) {
        for (const cardId of giveCards) {
          await applyAtom(ctx.state, { type: '给予', cardId, from: ownerId, to: target });
        }
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '好施',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '好施',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
