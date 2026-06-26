// 南蛮入侵(普通锦囊):出牌阶段,对所有其他角色使用。
// 每名目标依次判定:若不打出【杀】,则受到使用者造成的 1 点伤害。
//
// 询问杀 后检查处理区:有杀牌 = 出了杀;没有 = 受伤害。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, type SkillModule, validateUseCard } from '../skill';
import { 询问无懈可击 } from '../无懈可击';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '南蛮入侵', description: '对所有其他角色使用,每名目标需出杀,否则受 1 点伤害' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(state, skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '南蛮入侵' });
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      await pushFrame(state, '南蛮入侵', from, { ...params });

      // 从使用者下家开始,按座次顺序结算(state.players 数组顺序 = seat index 顺序)
      const alivePlayers = state.players.filter(p => p.alive);
      const n = alivePlayers.length;
      const targets: number[] = [];
      if (n > 1) {
        // 找到 from 在 alivePlayers 中的位置
        const fromPos = alivePlayers.findIndex(p => p.index === from);
        if (fromPos >= 0) {
          // 从 from+1 开始顺时针取 n-1 个目标
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

      // 无懈可击对全体锦囊只抵消特定 1 名角色:逐目标询问无懈,被抵消的目标跳过。
      // 逐个询问杀:对每个目标先问无懈,未被抵消才检查是否出杀。
      try {
        for (const target of targets) {
          // 每次结算前重算存活
          if (!state.players[target]?.alive) continue;
          // 无懈抵消该目标 → 跳过
          const cancelled = await 询问无懈可击(state, target);
          if (cancelled) continue;

          await applyAtom(state, { type: '询问杀', target, source: from });
          // 检查处理区
          const killCardId = frameCards(state).find(id => {
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
            // 没出杀:受伤害
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
        if (frameCards(state).includes(cardId)) {
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
    label: '南蛮入侵',
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: '南蛮入侵',
      cardFilter: { filter: (c) => c.name === '南蛮入侵', min: 1, max: 1 },
    },
  });
}

