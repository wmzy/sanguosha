// 过河拆桥(普通锦囊):
//   出牌阶段,对 1 名其他角色使用(无距离限制)。
//   弃置该角色区域内(手牌、装备区、判定区)的 1 张牌。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '过河拆桥', description: '锦囊:弃置目标一张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (!Array.isArray(params.targets) || typeof params.targets[0] !== 'number') return 'target required';
      const targetIdx = params.targets[0];
      const cardInHand = !!self?.hand.includes(params.cardId);
      const cardNameOk = state.cardMap[params.cardId]?.name === '过河拆桥';
      const targetPlayer = state.players[targetIdx];
      const notSelf = targetIdx !== ownerId;
      const targetAlive = targetPlayer?.alive === true;
      const targetHasCards = !!targetPlayer && (targetPlayer.hand.length > 0 || Object.keys(targetPlayer.equipment).length > 0 || targetPlayer.pendingTricks.length > 0);
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && notSelf && targetAlive && targetHasCards;
      return ok ? null : '过河拆桥使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '过河拆桥', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.targets as number[])?.[0] ?? params.target as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击:锦囊异常安全 + localVars 初始化/清理
      state.localVars['无懈/被抵消'] = false;
      try {
        await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
        if (!state.localVars['无懈/被抵消']) {
          // 弃目标一张牌:判定区优先(延时锦囊的原卡在 use 阶段已进弃牌堆,只需 移除延时锦囊),再手牌,再装备区
          const targetPlayer = state.players[target];
          if (targetPlayer) {
            if (targetPlayer.pendingTricks.length > 0) {
              const trickName = targetPlayer.pendingTricks[0].name;
              await applyAtom(state, { type: '移除延时锦囊', player: target, trickName });
            } else if (targetPlayer.hand.length > 0) {
              await applyAtom(state, { type: '弃置', player: target, cardIds: [targetPlayer.hand[0]] });
            } else {
              for (const slot of ['武器', '防具', '进攻马', '防御马', '宝物'] as const) {
                const id = targetPlayer.equipment?.[slot];
                if (id) {
                  await applyAtom(state, { type: '弃置', player: target, cardIds: [id] });
                  break;
                }
              }
            }
          }
        }
        // 移锦囊到弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        // 异常时保证处理区清理与状态恢复
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
    label: '过河拆桥',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '过河拆桥',
      cardFilter: { filter: (c) => c.name === '过河拆桥', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
}