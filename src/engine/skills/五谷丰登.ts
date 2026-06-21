// 五谷丰登(普通锦囊):出牌阶段对所有存活角色使用。
//   流程:
//     1. 从牌堆顶翻 X 张到处理区亮出(X = 存活玩家数)
//     2. 从使用者开始,按座次顺序,每名目标依次选 1 张到手牌
//     3. 剩余牌置入弃牌堆
//   可被无懈可击抵消(项目惯例:一张无懈抵消整个锦囊,与其他全体锦囊一致)
//
// 实现要点:
//   - 亮牌用 `移动牌`(逐张 牌堆→处理区),不用 `摸牌`(会直接进手牌)
//   - 选牌用 `请求回应`(type: useCard),每名玩家选一张处理区中的牌
//   - respond action 接受 cardId,校验在处理区,移牌到手牌
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '五谷丰登', description: '锦囊:从牌堆亮出N张,全体依次选1张' };
}

/** 取当前存活玩家列表(按座次) */
function alivePlayers(state: GameState): number[] {
  return state.players.filter(p => p.alive).map(p => p.index);
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  // ── use:主动打出五谷丰登 ──
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0;
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      const cardInHand = !!self?.hand.includes(params.cardId);
      const cardNameOk = state.cardMap[params.cardId]?.name === '五谷丰登';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk;
      return ok ? null : '五谷丰登使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      pushFrame(state, '五谷丰登', from, { ...params });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });

      state.localVars['无懈/被抵消'] = false;
      try {
        await applyAtom(state, {
          type: '请求回应',
          requestType: '无懈可击',
          target: -2,
          prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } },
          timeout: 10,
        });

        if (!state.localVars['无懈/被抵消']) {
          // 亮出 X 张到处理区(X = 存活玩家数)
          const targets = alivePlayers(state);
          const cardCount = targets.length;
          for (let i = 0; i < cardCount; i++) {
            if (state.zones.deck.length === 0) break;
            const topId = state.zones.deck.shift()!;
            state.zones.processing.push(topId);
          }

          // 从使用者开始按座次依次选牌
          for (const targetIdx of targets) {
            const pool = [...state.zones.processing];
            if (pool.length === 0) break;

            // 清掉上次选牌结果
            delete state.localVars['五谷丰登/选择'];
            await applyAtom(state, {
              type: '请求回应',
              requestType: '五谷丰登/select',
              target: targetIdx,
              prompt: {
                type: 'useCard',
                title: '五谷丰登:选择 1 张牌',
                cardFilter: { filter: (c) => pool.includes(c.id), min: 1, max: 1 },
              },
              timeout: 20,
            });
            const pickedId = state.localVars['五谷丰登/选择'] as string | undefined;
            if (pickedId && state.zones.processing.includes(pickedId)) {
              await applyAtom(state, {
                type: '移动牌',
                cardId: pickedId,
                from: { zone: '处理区' },
                to: { zone: '手牌', player: targetIdx },
              });
            }
          }

          // 剩余亮出的牌进弃牌堆
          const leftover = [...state.zones.processing];
          for (const id of leftover) {
            await applyAtom(state, { type: '移动牌', cardId: id, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
          }
        }
        // 原锦囊卡进弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        delete state.localVars['无懈/被抵消'];
        delete state.localVars['五谷丰登/选择'];
        popFrame(state);
      }
    });

  // ── respond:玩家选1张牌(从处理区亮的牌中) ──
  registerAction(_skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是五谷丰登选牌窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '五谷丰登/select') return '当前不是五谷丰登选牌窗口';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      if (!state.zones.processing.includes(cardId)) return '该牌不在可选范围';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      state.localVars['五谷丰登/选择'] = cardId;
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '五谷丰登',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '五谷丰登',
      cardFilter: { filter: (c) => c.name === '五谷丰登', min: 1, max: 1 },
    },
  });
  api.defineAction('respond', {
    label: '五谷丰登',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '五谷丰登:选1张牌',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
  });
}
