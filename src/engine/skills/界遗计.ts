// 界遗计(界郭嘉·被动技):当你受到 1 点伤害后,你可以摸两张牌,
// 然后你可以交给至多两名其他角色共计至多两张手牌(每 1 点伤害触发一次)。
//
// 与标版遗计区别:
//   - 标版:摸两张牌,然后将【摸到的两张牌】分配给任意角色(分配强制、限于摸到的牌)。
//   - 界版:摸两张牌,然后可以将【至多两张任意手牌】交给【至多两名其他角色】(可选、
//     可从任意手牌中选,总数至多 2 张、目标至多 2 人)。
//   交牌是可选的:confirm 询问;无其他存活角色或自己无手牌时跳过交牌环节。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

// 内部 requestType/localVars 键名保持原前缀「遗计/」,不改为「界遗计/」
const CONFIRM_RT = '遗计/giveConfirm'; // 界郭嘉:是否交牌
const GIVE_RT = '遗计/giveCard'; // 界郭嘉:选牌+选目标(至多 2 张给至多 2 人)
const CONFIRMED_KEY = '遗计/confirmed';
const ALLOC_KEY = '遗计/allocation';

type Allocation = Array<{ target: number; cardIds: string[] }>;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界遗计',
    description: '受到 1 点伤害后,摸两张牌,然后可以将至多两张手牌交给至多两名其他角色',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理 confirm + distribute(交牌)两种询问 ──
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

      // giveCard(distribute/allocate):校验 allocation
      // 至多 2 名其他角色 + 共计至多 2 张手牌 + 每目标至少 1 张 + 牌均在手 + 无重复
      const allocation = params.allocation as Allocation | undefined;
      if (!Array.isArray(allocation) || allocation.length === 0) {
        return '请选择分配方案';
      }
      if (allocation.length > 2) return '至多交给两名其他角色';
      const totalCards = allocation.reduce((n, e) => n + e.cardIds.length, 0);
      if (totalCards > 2) return '至多交出两张手牌';
      const seenCards = new Set<string>();
      for (const e of allocation) {
        if (e.cardIds.length === 0) return '分配数量不合法';
        if (e.target === ownerId) return '不能交给自己';
        if (!st.players[e.target]?.alive) return '目标无效';
        for (const cid of e.cardIds) {
          if (seenCards.has(cid)) return '存在重复的牌';
          seenCards.add(cid);
          if (!st.players[ownerId]?.hand.includes(cid)) return '牌不在手牌中';
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === GIVE_RT) {
        st.localVars[ALLOC_KEY] =
          (params.allocation as Allocation | undefined) ?? null;
      }
    },
  );

  // ── 造成伤害 after:每 1 点伤害触发一次 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    const amount = atom.amount ?? 0;
    if (amount <= 0) return;

    for (let i = 0; i < amount; i++) {
      if (!ctx.state.players[ownerId]?.alive) break;

      // 1) 摸两张牌
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 2 });

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
          title: '遗计:是否将至多两张手牌交给至多两名其他角色?',
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

      // 4) 选至多两张手牌 + 选至多两名其他存活角色
      delete ctx.state.localVars[ALLOC_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: GIVE_RT,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'allocate',
          title: '遗计:将至多两张手牌交给至多两名其他角色',
          source: 'hand',
          minPerTarget: 1,
          maxPerTarget: 2,
          minTotal: 1,
          maxTotal: 2,
          allowSelf: false,
          targetFilter: (_view, t) => t !== ownerId && ctx.state.players[t]?.alive === true,
        },
        timeout: 30,
      });

      const allocation = ctx.state.localVars[ALLOC_KEY] as Allocation | null;
      delete ctx.state.localVars[CONFIRMED_KEY];
      delete ctx.state.localVars[ALLOC_KEY];

      // 5) 给予牌(再次校验,防止状态变化)
      if (!Array.isArray(allocation) || allocation.length === 0) continue;
      if (allocation.length > 2) continue;
      const totalCards = allocation.reduce((n, e) => n + e.cardIds.length, 0);
      if (totalCards > 2) continue;
      for (const entry of allocation) {
        if (entry.target === ownerId) continue;
        if (!ctx.state.players[entry.target]?.alive) continue;
        for (const cardId of entry.cardIds) {
          if (!ctx.state.players[ownerId]?.hand.includes(cardId)) continue;
          await applyAtom(ctx.state, { type: '给予', cardId, from: ownerId, to: entry.target });
        }
      }
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
