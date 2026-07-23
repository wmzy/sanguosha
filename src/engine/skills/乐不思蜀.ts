// 乐不思蜀(延时锦囊):出牌阶段对距离 1 以内的一名其他角色使用。
//
// 两段式结算（use.md 延迟类锦囊）：
//   第一段（出牌阶段，runUseFlow delayed=true）：声明目标 → 置入判定区 → 使用结算前 → 暂停
//   第二段（判定阶段，本 hook 恢复）：询问无懈 → resumeDelayedSettlement → resolve(判定+效果)
//
// 判定结果：非♥ → 跳过出牌阶段；♥ → 无效弃置。
// 跳过出牌阶段通过标签实现：resolve 加标签，出牌阶段 before-hook 消费。

import type { FrontendAPI, GameState, GameView, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, validateUseCard } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';
import { 询问无懈可击 } from '../无懈可击';
import { skipPhase } from '../skip-phase';
import { runUseFlow, resumeDelayedSettlement } from '../card-effect/use-card';

/** 跳过出牌阶段的 tag 名(实现为 mark id='tag:乐不思蜀/跳过出牌') */
const SKIP_TAG = '乐不思蜀/跳过出牌';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '乐不思蜀', description: '延时锦囊:判定非红桃则跳过出牌阶段' };
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
        validateUseCard(state, ownerId, params, { cardName: '乐不思蜀' }) ??
        (() => {
          const t = params.target ?? (params.targets as number[] | undefined)?.[0];
          return typeof t === 'number' &&
            t !== ownerId &&
            state.players[t]?.alive &&
            effectiveDistance(state, ownerId, t) <= 1
            ? null
            : '目标不合法';
        })()
      );
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const target = (params.target ?? (params.targets as number[])[0]) as number;
      await runUseFlow(state, ownerId, cardId, [target], '乐不思蜀');
    },
  );

  // ─── 判定阶段:有 乐不思蜀 → 询问无懈 → 恢复使用结算中 ───────
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '判定') return;
    const self = ctx.state.players[ownerId];
    if (!self.pendingTricks.some((t) => t.name === '乐不思蜀')) return;
    if (ctx.state.zones.deck.length === 0) return;

    const cancelled = await 询问无懈可击(ctx.state, ownerId);
    if (cancelled) {
      // 被无懈抵消:移除延时锦囊,跳过判定
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '乐不思蜀' });
      return;
    }

    // 恢复使用结算中（resolve 触发判定 + 执行效果）
    const trick = self.pendingTricks.find((t) => t.name === '乐不思蜀');
    if (!trick) return;
    await resumeDelayedSettlement(ctx.state, trick.source, ownerId, '乐不思蜀', trick.card.id);
  });

  // ─── 出牌阶段:有跳过标签 → 跳过出牌阶段 ────────────────────
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '出牌') return;
    const self = ctx.state.players[ownerId];
    if (!self.tags.includes(SKIP_TAG)) return;

    return skipPhase(ctx.state, atom, SKIP_TAG);
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '乐不思蜀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '乐不思蜀',
      cardFilter: { filter: (c) => c.name === '乐不思蜀', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) =>
          viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
      },
    },
  });
}

export default { createSkill, onInit, onMount };
