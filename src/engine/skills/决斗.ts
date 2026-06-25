// 决斗(普通锦囊):出牌阶段,对一名其他角色使用。
// 目标先开始,与使用者轮流出杀,首先不出杀的一方受到对方造成的 1 点伤害。
//
// 询问杀 后检查处理区:有杀牌 = 出了杀;没有 = 没出(输)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill'
import { askWuxie } from '../wuxie';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '决斗', description: '对一名角色使用,双方轮流出杀,先不出者受 1 点伤害' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 手牌 + 牌名 + 目标合法
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state)
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const cardNameOk = cardIdOk && state.cardMap[cardId]?.name === '决斗';
      const targetIdx = params.target as number | undefined;
      const targetExists = typeof targetIdx === 'number' && !!state.players[targetIdx];
      const targetAlive = targetExists && state.players[targetIdx as number]?.alive === true;
      const targetNotSelf = targetIdx !== ownerId;
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && targetExists && targetAlive && targetNotSelf;
      return ok ? null : '现在不能使用决斗';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as number;
      await pushFrame(state, '决斗', from, { ...params });

      // 决斗锦囊进处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 询问无懈可击(单目标锦囊:抵消整个锦囊)
      try {
        const cancelled = await askWuxie(state, target);
        if (!cancelled) {
          // 决斗循环:目标先出杀,之后发起者出杀,轮流。
          // 上限保护:极端情况下(武圣/丈八 把任意牌当杀)可能无限循环;
          // 现实中手牌+牌堆不可能产出这么多杀,100 轮远超正常上限。
          const MAX_ROUNDS = 100;
          let turn = 0; // 0=目标, 1=发起者
          let loser: number | null = null;
          let rounds = 0;
          while (loser === null) {
            if (rounds++ >= MAX_ROUNDS) {
              // 理论不应触发:任一玩家手牌+牌堆合起来也产不出这么多杀。
              // 兜底:记当前玩家为输家,跳出死循环。
              loser = turn === 0 ? target : from;
              break;
            }
            const current = turn === 0 ? target : from;
            await applyAtom(state, { type: '询问杀', target: current, source: turn === 0 ? from : target });
            // 检查处理区:有杀牌 = 出了杀,移走它;没有 = 没出,输
            const killCardId = state.zones.processing.find(id => {
              const c = state.cardMap[id];
              return c && c.name === '杀';
            });
            if (killCardId) {
              // 出了杀:移到弃牌堆,切换轮次
              await applyAtom(state, {
                type: '移动牌',
                cardId: killCardId,
                from: { zone: '处理区' },
                to: { zone: '弃牌堆' },
              });
              turn = turn === 0 ? 1 : 0;
            } else {
              loser = current;
            }
          }
          const winner = loser === target ? from : target;
          await applyAtom(state, { type: '造成伤害', target: loser, amount: 1, source: winner, cardId });
        }
        // 决斗锦囊移出处理区→弃牌堆
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
        await popFrame(state);
      }
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '决斗',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '决斗',
      cardFilter: { filter: (c) => c.name === '决斗', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
}

