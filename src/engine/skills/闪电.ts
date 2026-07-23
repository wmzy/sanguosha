// 闪电(延时锦囊,可传递):出牌阶段对自己使用,放进自己判定区。
//
// 两段式结算（use.md 延迟类锦囊）：
//   第一段（出牌阶段，runUseFlow delayed=true）：声明 → 置入自己判定区 → 使用结算前 → 暂停
//   第二段（判定阶段，本 hook 恢复）：询问无懈 → resumeDelayedSettlement → resolve(判定+效果)
//
// 判定结果（在 card-effects/闪电.ts resolve 中实现）：
//   ♠2~9 → 受到 3 点无来源雷电伤害,闪电进弃牌堆
//   其他 → 闪电传递给下家（下家的判定区）
//
// 闪电的特殊逻辑（传递到下家）在 card-effects/闪电.ts 中实现。

import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, validateUseCard } from '../skill';
import { 询问无懈可击 } from '../无懈可击';
import { runUseFlow, resumeDelayedSettlement } from '../card-effect/use-card';

const TRICK_NAME = '闪电';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: TRICK_NAME,
    description: '延时锦囊:判定黑桃2-9则受3点雷电伤害,否则传给下家',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── use action:委托 runUseFlow（delayed=true 置入判定区） ────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return (
        validateUseCard(state, ownerId, params, { cardName: TRICK_NAME }) ??
        (() => {
          // 闪电对自己使用;若自己判定区已有闪电则不可重复放置
          const self = state.players[ownerId];
          return self.pendingTricks.some((t) => t.name === TRICK_NAME)
            ? '判定区已有闪电'
            : null;
        })()
      );
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 闪电对自己使用
      await runUseFlow(state, ownerId, cardId, [ownerId], TRICK_NAME);
    },
  );

  // ─── 判定阶段:有 闪电 → 询问无懈 → 恢复使用结算中 ──────────
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '判定') return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    if (!self.pendingTricks.some((t) => t.name === TRICK_NAME)) return;
    if (ctx.state.zones.deck.length === 0) return;

    const cancelled = await 询问无懈可击(ctx.state, ownerId);
    if (cancelled) {
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: TRICK_NAME });
      return;
    }

    const trick = self.pendingTricks.find((t) => t.name === TRICK_NAME);
    if (!trick) return;
    await resumeDelayedSettlement(ctx.state, trick.source, ownerId, TRICK_NAME, trick.card.id);
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: TRICK_NAME,
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: TRICK_NAME,
      cardFilter: { filter: (c) => c.name === TRICK_NAME, min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount };
