// 兵粮寸断(延时锦囊):出牌阶段对距离 1 以内的一名其他角色使用。
//
// 两段式结算（use.md 延迟类锦囊），与乐不思蜀对称——差异：判定花色（♣ vs ♥），跳过阶段（摸牌 vs 出牌）。
//   第一段（出牌阶段，runUseFlow delayed=true）：声明目标 → 置入判定区 → 使用结算前 → 暂停
//   第二段（判定阶段，本 hook 恢复）：询问无懈 → resumeDelayedSettlement → resolve(判定+效果)
//
// 判定结果：非♣ → 跳过摸牌阶段；♣ → 无效弃置。

import type { FrontendAPI, GameState, GameView, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, validateUseCard } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';
import { 询问无懈可击 } from '../无懈可击';
import { skipPhase } from '../skip-phase';
import { runUseFlow, resumeDelayedSettlement } from '../card-effect/use-card';

/** 跳过摸牌阶段的 tag 名 */
const SKIP_TAG = '兵粮寸断/跳过摸牌';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '兵粮寸断', description: '延时锦囊:判定非梅花则跳过摸牌阶段' };
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
        validateUseCard(state, ownerId, params, { cardName: '兵粮寸断' }) ??
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
      await runUseFlow(state, ownerId, cardId, [target], '兵粮寸断');
    },
  );

  // ─── 判定阶段:有 兵粮寸断 → 询问无懈 → 恢复使用结算中 ───────
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '判定') return;
    const self = ctx.state.players[ownerId];
    if (!self.pendingTricks.some((t) => t.name === '兵粮寸断')) return;
    if (ctx.state.zones.deck.length === 0) return;

    const cancelled = await 询问无懈可击(ctx.state, ownerId);
    if (cancelled) {
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '兵粮寸断' });
      return;
    }

    const trick = self.pendingTricks.find((t) => t.name === '兵粮寸断');
    if (!trick) return;
    await resumeDelayedSettlement(ctx.state, trick.source, ownerId, '兵粮寸断', trick.card.id);
  });

  // ─── 摸牌阶段:有跳过标签 → 跳过摸牌阶段 ────────────────────
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '摸牌') return;
    const self = ctx.state.players[ownerId];
    if (!self.tags.includes(SKIP_TAG)) return;

    return skipPhase(ctx.state, atom, SKIP_TAG);
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '兵粮寸断',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '兵粮寸断',
      cardFilter: { filter: (c) => c.name === '兵粮寸断', min: 1, max: 1 },
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
