// 界遗计(界郭嘉·被动技):当你受到 1 点伤害后,你可以摸一张牌,
// 然后可以将一张手牌交给一名其他角色(每 1 点伤害触发一次)。
//
// 与标版遗计区别:
//   - 标版:摸两张牌,然后将两张牌(摸到的)分配给任意角色。
//   - 界版:摸一张牌,然后可以将一张已有手牌(任意)交给一名其他角色(可选)。
//   交牌是可选的:confirm 询问;无其他存活角色或自己无手牌时跳过交牌环节。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

// 内部 requestType/localVars 键名保持原前缀「遗计/」,不改为「界遗计/」
const CONFIRM_RT = '遗计/giveConfirm'; // 界郭嘉:是否交牌
const GIVE_RT = '遗计/giveCard'; // 界郭嘉:选牌+选目标
const CONFIRMED_KEY = '遗计/confirmed';
const CARD_KEY = '遗计/cardId';
const TARGET_KEY = '遗计/target';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界遗计',
    description: '受到 1 点伤害后,摸一张牌,然后可以将一张手牌交给一名其他角色',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理 confirm + useCardAndTarget 两种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== GIVE_RT) return '当前不是遗计询问';
      if (rt === CONFIRM_RT) return null; // confirm:任意 choice 均可(含放弃)

      // giveCard:校验 cardId + target
      const cardId = params.cardId as string | undefined;
      const target = params.target as number | undefined;
      if (typeof cardId !== 'string') return '请选择一张手牌';
      if (!st.players[ownerId]?.hand.includes(cardId)) return '牌不在手牌中';
      if (typeof target !== 'number') return '请选择交牌目标';
      if (target === ownerId) return '不能交给自己';
      if (!st.players[target]?.alive) return '目标无效';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === GIVE_RT) {
        st.localVars[CARD_KEY] = (params.cardId as string) ?? null;
        st.localVars[TARGET_KEY] = (params.target as number) ?? null;
      }
    },
  );

  // ── 造成伤害 after:每 1 点伤害触发一次 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; amount?: number };
    if (atom.target !== ownerId) return;
    const amount = atom.amount ?? 0;
    if (amount <= 0) return;

    for (let i = 0; i < amount; i++) {
      if (!ctx.state.players[ownerId]?.alive) break;

      // 1) 摸一张牌
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });

      // 2) 交牌前提:自己有手牌 + 场上有其他存活角色
      const self = ctx.state.players[ownerId];
      if (!self?.alive || self.hand.length === 0) continue;
      const hasOtherAlive = ctx.state.players.some((p, idx) => idx !== ownerId && p.alive);
      if (!hasOtherAlive) continue;

      // 3) 询问是否交牌(可选)
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '遗计:是否将一张手牌交给其他角色?',
          confirmLabel: '交牌',
          cancelLabel: '不交',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) {
        delete ctx.state.localVars[CONFIRMED_KEY];
        continue;
      }

      // 4) 选一张手牌 + 选一名其他存活角色
      delete ctx.state.localVars[CARD_KEY];
      delete ctx.state.localVars[TARGET_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: GIVE_RT,
        target: ownerId,
        prompt: {
          type: 'useCardAndTarget',
          title: '遗计:选择一张手牌与一名其他角色',
          cardFilter: { filter: () => true, min: 1, max: 1 },
          targetFilter: {
            min: 1,
            max: 1,
            filter: (_view, t) => t !== ownerId && ctx.state.players[t]?.alive === true,
          },
        },
        timeout: 30,
      });

      const cardId = ctx.state.localVars[CARD_KEY] as string | undefined;
      const target = ctx.state.localVars[TARGET_KEY] as number | undefined;
      delete ctx.state.localVars[CONFIRMED_KEY];
      delete ctx.state.localVars[CARD_KEY];
      delete ctx.state.localVars[TARGET_KEY];

      // 5) 给予牌(再次校验,防止状态变化)
      if (typeof cardId !== 'string' || typeof target !== 'number') continue;
      if (target === ownerId) continue;
      if (!ctx.state.players[target]?.alive) continue;
      if (!ctx.state.players[ownerId]?.hand.includes(cardId)) continue;

      await applyAtom(ctx.state, { type: '给予', cardId, from: ownerId, to: target });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界遗计',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动遗计?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
