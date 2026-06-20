// 顺手牵羊(普通锦囊):
//   出牌阶段,对距离 1 内的一名其他角色使用,获得其一张牌。
import type { FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '顺手牵羊', description: '锦囊:获得目标一张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
    const myTurn = state.currentPlayerIndex === ownerId;
    const inActPhase = state.phase === '出牌';
    const free = state.pendingSlots.size === 0
    const self = state.players[ownerId];
    const selfAlive = self?.alive === true;
    if (typeof params.cardId !== 'string') return 'cardId required';
    // target 兼容单数 target 和复数 targets[0](前端非延时锦囊发 targets 数组)
    const target = params.target as number | undefined ?? (params.targets as number[] | undefined)?.[0];
    if (typeof target !== 'number') return 'target required';
    const cardInHand = !!self?.hand.includes(params.cardId);
    const cardNameOk = state.cardMap[params.cardId]?.name === '顺手牵羊';
    const notSelf = target !== ownerId;
    // 距离检查
    const inRange = effectiveDistance(state, ownerId, target as number) <= 1;
    const targetPlayer = state.players[target];
    const targetAlive = targetPlayer?.alive === true;
    const targetHasHand = !!targetPlayer && targetPlayer.hand.length > 0;
    const targetHasEquip = !!targetPlayer && Object.keys(targetPlayer.equipment).length > 0;
    const targetHasCard = targetHasHand || targetHasEquip;
    const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && notSelf && inRange && targetAlive && targetHasCard;
    return ok ? null : '顺手牵羊使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      pushFrame(state, '顺手牵羊', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0] as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击:锦囊异常安全 + localVars 初始化/清理
      state.localVars['无懈/被抵消'] = false;
      try {
        await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
        if (!state.localVars['无懈/被抵消']) {
          // 获得目标一张牌:优先手牌,手牌空时拿装备区第一槽(获得 atom 同时从装备区移除)
          const targetPlayer = state.players[target];
          if (targetPlayer) {
            if (targetPlayer.hand.length > 0) {
              await applyAtom(state, { type: '获得', player: from, cardId: targetPlayer.hand[0], from: target });
            } else {
              for (const slot of ['武器', '防具', '进攻马', '防御马', '宝物'] as const) {
                const id = targetPlayer.equipment?.[slot];
                if (id) {
                  await applyAtom(state, { type: '获得', player: from, cardId: id, from: target });
                  break;
                }
              }
            }
          }
        }
        // 移锦囊到弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        delete state.localVars['无懈/被抵消'];
        popFrame(state);
      }
    }, );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '顺手牵羊',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '顺手牵羊',
      cardFilter: { filter: (c) => c.name === '顺手牵羊', min: 1, max: 1 },
      targetFilter: {
        min: 1, max: 1,
        // 距离≤1 检查:filter 仅为前端 UI 提示,后端 validate 独立校验
        filter: (view: GameView, t: number) => viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
      },
    },
  });
}