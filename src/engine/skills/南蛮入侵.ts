// 南蛮入侵(普通锦囊):出牌阶段,对所有其他角色使用。
// 每名目标依次判定:若不打出【杀】,则受到使用者造成的 1 点伤害。
//
// 询问杀 后检查处理区:有杀牌 = 出了杀;没有 = 受伤害。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '南蛮入侵', description: '对所有其他角色使用,每名目标需出杀,否则受 1 点伤害' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 手牌 + 牌名
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const cardInHand = cardIdOk && self?.hand.includes(cardId);
      const cardNameOk = cardIdOk && state.cardMap[cardId]?.name === '南蛮入侵';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk;
      return ok ? null : '现在不能使用南蛮入侵';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      pushFrame(state, '南蛮入侵', from, { ...params });

      // 从使用者下家开始,按座次顺序结算(state.players 数组顺序 = seat index 顺序)
      const alivePlayers = state.players.filter(p => p.alive);
      const n = alivePlayers.length;
      const targets: number[] = [];
      if (n > 1) {
        const fromPos = alivePlayers.findIndex(p => p.index === from);
        if (fromPos >= 0) {
          for (let i = 1; i < n; i++) {
            targets.push(alivePlayers[(fromPos + i) % n].index);
          }
        }
      }

      // 锦囊进处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 被无懈抵消则跳过效果
      state.localVars['无懈/被抵消'] = false;
      try {
        await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
        if (!state.localVars['无懈/被抵消']) {
          // 逐个询问杀,检查处理区判断是否出杀
          const notResponded: number[] = [];
          for (const target of targets) {
            // 每次结算前重算存活:前一个目标可能已被其他效果击杀
            if (!state.players[target]?.alive) continue;
            await applyAtom(state, { type: '询问杀', target, source: from });
            // 检查处理区
            const killCardId = state.zones.processing.find(id => {
              const c = state.cardMap[id];
              return c && c.name === '杀';
            });
            if (killCardId) {
              // 出了杀:移到弃牌堆
              await applyAtom(state, {
                type: '移动牌',
                cardId: killCardId,
                from: { zone: '处理区' },
                to: { zone: '弃牌堆' },
              });
            } else {
              notResponded.push(target);
            }
          }

          // 对未出杀者造成伤害
          for (const target of notResponded) {
            if (!state.players[target]?.alive) continue;
            await applyAtom(state, { type: '造成伤害', target, amount: 1, source: from, cardId });
          }
        }
        // 锦囊移出处理区→弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        // 异常时保证处理区清理与状态恢复
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        delete state.localVars['无懈/被抵消'];
        popFrame(state);
      }
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '南蛮入侵',
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: '南蛮入侵',
      cardFilter: { filter: (c) => c.name === '南蛮入侵', min: 1, max: 1 },
    },
  });
}

