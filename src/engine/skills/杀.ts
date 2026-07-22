// 杀(基本牌):
//   use:出牌阶段对攻击范围内一名角色使用,目标须出闪抵消,否则受 1 点伤害。
//   respond:决斗/南蛮入侵等场景,目标"出杀抵消"——杀牌移到处理区供调用方结算。
//
// use 的结算逻辑已迁移到 card-effects/杀.ts (CardEffect.resolve + onSettle)。
// execute 委托 runUseFlow 编排完整使用结算流程（文档 use.md）。
// 无双/肉林通过 PostDodgeAskHook 解耦，不再直接 import。
//
// respond 保留在杀.ts（打出杀进处理区供决斗/南蛮入侵检查）。
import type { FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, validateUseCard } from '../skill';
import { inAttackRange } from '../distance';
import { viewCanAttack } from '../viewDistance';
import { canSlash } from '../slash-quota';
import { defaultPlayActive, viewCanSlash } from '../action-active';
import { runUseFlow } from '../card-effect/use-card';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '杀', description: '出牌阶段对攻击范围内一名角色使用' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // ── use:主动出杀 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const baseErr = validateUseCard(state, ownerId, params, {
        cardName: '杀',
        requireTarget: true,
      });
      if (baseErr) return baseErr;
      const cardId = params.cardId as string | undefined;
      // 距离 / 次数 豁免均由各技能自行注册 provider(distance.registerAttackRangeExemptor /
      // slash-quota.registerSlashExemptor),本文件不感知具体技能。
      const targetsOk =
        Array.isArray(params.targets) &&
        (params.targets as number[]).every((t) => {
          if (state.players[t]?.alive !== true) return false;
          return inAttackRange(state, ownerId, t, cardId);
        });
      if (!targetsOk) return '目标不合法';
      return canSlash(state, ownerId, cardId) ? null : '出杀次数已达上限';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const targets = params.targets as number[];
      // 结算逻辑委托 runUseFlow → CardEffect['杀'].resolve + onSettle
      await runUseFlow(state, ownerId, cardId, targets, '杀');
    },
  );

  // ── respond:被询问出杀(决斗/南蛮入侵等)——杀牌进处理区供调用方结算 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      // pending 必须是 询问杀 或 请求回应(借刀杀人/激将)
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      const atomType = slot.atom.type;
      const reqType = (slot.atom as { requestType?: string }).requestType;
      const pendingMatches =
        atomType === '询问杀' ||
        (atomType === '请求回应' && (reqType === '杀/forceKill' || reqType === '杀/respondKill'));
      if (!pendingMatches) return '当前不是出杀的窗口';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (card?.name !== '杀') return '只能打出杀';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return;
      // 杀牌进处理区,供调用方(决斗/南蛮入侵)检查处理区判断是否出了杀
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '处理区' },
      });
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '杀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '出杀',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 3,
        // 攻击范围检查:filter 仅为前端 UI 提示(高亮/禁用),后端 validate 独立校验
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    activeWhen: (ctx) => defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx),
  });
  api.defineAction('respond', {
    label: '出杀',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '打出杀',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
    },
  });
}
