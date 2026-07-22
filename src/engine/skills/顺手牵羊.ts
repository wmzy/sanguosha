// 顺手牵羊(普通锦囊):
//   出牌阶段,对距离 1 内的一名其他角色使用,获得其区域内(手牌/装备区/判定区)的一张牌。
//
// 选牌交互同过河拆桥:出牌 → 询问无懈 → 弹选牌面板 → 使用者按区域选。
// 区别:获得(而非弃置)目标牌。判定区延时锦囊也可被获得。
// 选牌面板逻辑见 ./选牌面板.ts(与过河拆桥/反馈共用)。
import type { FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { registerAction, validateUseCard } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';
import { runUseFlow } from '../card-effect/use-card';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '顺手牵羊', description: '锦囊:获得目标一张牌' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return (
        validateUseCard(state, ownerId, params, { cardName: '顺手牵羊' }) ??
        (() => {
          const target =
            (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
          if (target === undefined) return '目标不合法';
          if (target === ownerId) return '不能对自己使用';
          if (!state.players[target]?.alive) return '目标已死亡';
          // 奇才(黄月英):使用锦囊牌无距离限制 → 跳过距离校验
          const ignoreDistance = !!state.players[ownerId]?.tags.includes(
            '奇才/无距离限制',
          );
          if (!ignoreDistance && effectiveDistance(state, ownerId, target) > 1)
            return '距离太远';
          const p = state.players[target];
          if (!p) return '目标不合法';
          const hasCards =
            p.hand.length > 0 || Object.keys(p.equipment).length > 0 || p.pendingTricks.length > 0;
          if (!hasCards) return '目标无可获取的牌';
          return null;
        })()
      );
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const target =
        ((params.target as number | undefined) ??
          (params.targets as number[] | undefined)?.[0]) as number;
      // 结算逻辑委托 runUseFlow → CardEffect['顺手牵羊'].resolve
      await runUseFlow(state, ownerId, cardId, [target], '顺手牵羊');
    },
  );

  // ── 选牌 respond:使用者从目标区域选一张牌 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是选牌窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '顺手牵羊_选牌') return '当前不是选牌窗口';
      const zone = params.zone;
      if (zone === 'equipment' || zone === 'judge') {
        if (typeof params.cardId !== 'string') return 'cardId required';
      } else if (zone === 'hand') {
        if (typeof params.handIndex !== 'number') return 'handIndex required';
      } else {
        return 'zone required (equipment|judge|hand)';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      state.localVars['选牌/结果'] = {
        zone: params.zone,
        cardId: params.cardId ?? null,
        handIndex: params.handIndex ?? null,
      };
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '顺手牵羊',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '顺手牵羊',
      cardFilter: { filter: (c) => c.name === '顺手牵羊', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 距离≤1 检查:filter 仅为前端 UI 提示,后端 validate 独立校验
        filter: (view: GameView, t: number) =>
          viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
      },
    },
  });
}
