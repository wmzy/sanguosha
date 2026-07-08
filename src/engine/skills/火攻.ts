// 火攻(普通锦囊):出牌阶段对一名有手牌的其他角色使用。
// 目标展示一张手牌,然后若你弃置一张与所展示牌相同花色的手牌,
// 则对其造成 1 点火焰伤害。
//
// 流程(单目标锦囊模式):
//   1. 移火攻牌到处理区
//   2. 询问无懈可击(单目标,抵消整个锦囊)
//   3. 未被抵消 → 请求目标展示一张手牌(请求回应 requestType='火攻/展示')
//   4. 读展示牌花色 → 请求使用者弃一张同花色手牌(请求回应 requestType='火攻/弃牌')
//   5. 使用者弃了 → 造成 1 点火焰伤害(damageType:'火焰');没弃 → 无事发生
//   6. 火攻牌移出处理区 → 弃牌堆
//
// 跨玩家 respond:火攻在 DEFAULT_SKILLS 中,每个玩家都有火攻技能实例。
// 目标 B 的 respond 处理'火攻/展示'(B 是 target);使用者 A 的 respond 处理
// '火攻/弃牌'(A 是 target)。requestType 前缀 '火攻' 路由到本技能。
// 展示的牌不进弃牌堆(仅读取花色);使用者弃的牌进弃牌堆。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, validateUseCard } from '../skill';
import { 询问无懈可击 } from '../无懈可击';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '火攻',
    description: '锦囊:目标展示一张手牌,弃同花色手牌则造成1点火焰伤害',
  };
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
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = (params.targets as number[])[0];
      await pushFrame(state, '火攻', from, { ...params });

      // 火攻锦囊进处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      try {
        // 询问无懈可击(单目标锦囊:抵消整个锦囊)
        const cancelled = await 询问无懈可击(state, target);
        if (!cancelled) {
          const targetPlayer = state.players[target];
          // 目标必须有手牌(展示需要)。理论上 validate 已保证,中途手牌被无懈等移走则跳过。
          if (targetPlayer && targetPlayer.hand.length > 0) {
            // 清理上轮残留
            delete state.localVars['火攻/展示'];
            delete state.localVars['火攻/展示花色'];
            delete state.localVars['火攻/弃牌'];

            // ── 1) 请求目标展示一张手牌 ──
            // 超时兜底牌:目标未选 → 自动展示 hand[0](规则:目标必须展示)
            const revealFallback = targetPlayer.hand[0];
            await applyAtom(state, {
              type: '请求回应',
              requestType: '火攻/展示',
              target,
              prompt: {
                type: 'useCard',
                title: '火攻:展示一张手牌',
                cardFilter: { filter: () => true, min: 1, max: 1 },
              },
              timeout: 15,
            });

            let revealed = state.localVars['火攻/展示'] as
              | { cardId: string; suit: string }
              | undefined;
            if (!revealed) {
              // 超时:自动展示 hand[0]
              const rc = state.cardMap[revealFallback];
              revealed = { cardId: revealFallback, suit: rc?.suit ?? '' };
              state.localVars['火攻/展示'] = revealed;
              state.localVars['火攻/展示花色'] = revealed.suit;
            }
            const revealedSuit = revealed.suit;

            // ── 2) 请求使用者弃一张同花色手牌 ──
            // 使用者无同花色手牌 → 无法弃 → 无事发生(规则:"若你弃置..."条件不满足)
            const fromPlayer = state.players[from];
            if (fromPlayer?.alive) {
              const hasMatch = fromPlayer.hand.some(
                (id) => state.cardMap[id]?.suit === revealedSuit,
              );
              if (hasMatch) {
                delete state.localVars['火攻/弃牌'];
                await applyAtom(state, {
                  type: '请求回应',
                  requestType: '火攻/弃牌',
                  target: from,
                  prompt: {
                    type: 'useCard',
                    title: `火攻:弃置一张 ${revealedSuit} 手牌对其造成1点火焰伤害(不弃则无效)`,
                    cardFilter: {
                      filter: (c) => c.suit === revealedSuit,
                      min: 1,
                      max: 1,
                    },
                  },
                  timeout: 15,
                });

                const discardId = state.localVars['火攻/弃牌'] as string | undefined;
                // 使用者弃了 → 造成 1 点火焰伤害;没弃(超时)→ 无事发生
                if (discardId && state.players[target]?.alive) {
                  await applyAtom(state, { type: '弃置', player: from, cardIds: [discardId] });
                  await applyAtom(state, {
                    type: '造成伤害',
                    target,
                    amount: 1,
                    source: from,
                    cardId,
                    damageType: '火焰',
                  });
                }
              }
            }
          }
        }
        // 火攻锦囊移出处理区 → 弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        if (frameCards(state).includes(cardId)) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        await popFrame(state);
      }
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
