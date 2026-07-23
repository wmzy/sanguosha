// 火攻(普通锦囊):出牌阶段对一名有手牌的其他角色使用。
// 目标展示一张手牌,然后若你弃置一张与所展示牌相同花色的手牌,
// 则对其造成 1 点火焰伤害。
//
// 结算逻辑已迁移到 card-effects/火攻.ts (CardEffect.resolve)。
// execute 委托 runUseFlow 编排完整使用结算流程（文档 use.md）。
//
// respond action 保留在本技能：按 requestType 分流 '火攻/展示' 和 '火攻/弃牌'。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, validateUseCard } from '../skill';
import { runUseFlow } from '../card-effect/use-card';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '火攻', description: '锦囊:弃同花色牌造成火焰伤害' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── use action:出牌阶段对一名有手牌的其他角色使用 ──────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const base = validateUseCard(state, ownerId, params, {
        cardName: '火攻',
        requireTarget: true,
      });
      if (base) return base;
      const targets = params.targets as number[];
      if (targets.length !== 1) return '火攻只能指定一名目标';
      const target = targets[0];
      if (target === ownerId) return '不能对自己使用火攻';
      const targetPlayer = state.players[target];
      if (!targetPlayer?.alive) return '目标不合法';
      if (targetPlayer.hand.length === 0) return '目标必须有手牌';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const target = (params.targets as number[])[0];
      await runUseFlow(state, ownerId, cardId, [target], '火攻');
    },
  );

  // ─── respond action:目标展示 / 使用者弃牌 ────────────────────
  // 同一 respond 按 pending requestType 分流:
  //   '火攻/展示' → 目标选一张自己的手牌(任意),存花色
  //   '火攻/弃牌' → 使用者选一张同花色手牌,存 cardId
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是火攻窗口';
      const reqType = (slot.atom as { requestType?: string }).requestType;
      if (reqType !== '火攻/展示' && reqType !== '火攻/弃牌')
        return '当前不是火攻窗口';
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return 'cardId required';
      const self = state.players[ownerId];
      if (!self?.alive) return '你已死亡';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      if (reqType === '火攻/弃牌') {
        const revealedSuit = state.localVars['火攻/展示花色'] as string | undefined;
        const card = state.cardMap[cardId];
        if (!revealedSuit || card?.suit !== revealedSuit)
          return '必须弃置与展示牌相同花色的手牌';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId)!;
      const reqType = (slot.atom as { requestType: string }).requestType;
      const cardId = params.cardId as string;
      const card = state.cardMap[cardId];
      if (reqType === '火攻/展示') {
        state.localVars['火攻/展示'] = { cardId, suit: card?.suit ?? '' };
        state.localVars['火攻/展示花色'] = card?.suit ?? '';
      } else {
        state.localVars['火攻/弃牌'] = cardId;
      }
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '火攻',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '火攻',
      cardFilter: { filter: (c) => c.name === '火攻', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 目标须有手牌(前端 UI 提示用,后端 validate 独立校验)
        filter: (_view, _t) => true,
      },
    },
  });

  api.defineAction('respond', {
    label: '火攻',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '火攻',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
