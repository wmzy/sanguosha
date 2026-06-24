// 激将(刘备·主公技):
//   出牌阶段,主公可请求一名蜀势力角色出杀。
//   该角色选择出杀或不出(不出则主公摸 1 张)。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill'

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '激将',
    description: '主公技:请求一名蜀势力角色出杀,不出则摸 1 张',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 主公身份 + 目标合法
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state)
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      // 激将是主公技:仅主公位可用(以 character.isLord 或主公位身份判断,这里以主公位 ownerId===0 为依据)
      const isLord = ownerId === 0;
      // 目标合法:不是自己 + 存活 + 蜀势力
      const targetIdx = params.target as number | undefined;
      const targetExists = typeof targetIdx === 'number' && !!state.players[targetIdx];
      const target = targetExists ? state.players[targetIdx as number] : null;
      const targetNotSelf = targetIdx !== ownerId;
      const targetAlive = target?.alive === true;
      const targetShu = target?.faction === '蜀';
      // killTarget 校验:可选,若提供则需存活
      const killTargetIdx = params.killTarget as number | undefined;
      const killTargetValid = killTargetIdx === undefined || (state.players[killTargetIdx]?.alive === true && killTargetIdx !== targetIdx);
      const ok = myTurn && inActPhase && free && selfAlive && isLord && targetExists && targetNotSelf && targetAlive && targetShu && killTargetValid;
      return ok ? null : '现在不能使用激将';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;
      const killTarget = params.killTarget as number | undefined;
      pushFrame(state, '激将', from, { ...params });

      // 请求回应:目标选择出杀
      await applyAtom(state, {
        type: '请求回应',
        requestType: '杀/respondKill',
        target,
        prompt: { type: 'confirm', title: '主公激将:是否出杀?' },
        timeout: 15,
      });

      // 检查处理区:有杀 = 出了杀
      const killCardId = state.zones.processing.find(id => {
        const c = state.cardMap[id];
        return c && c.name === '杀';
      });

      if (killCardId) {
        // 出了杀:移到弃牌堆,执行杀效果
        await applyAtom(state, {
          type: '移动牌',
          cardId: killCardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
        if (typeof killTarget === 'number') {
          await applyAtom(state, { type: '指定目标', source: target, target: killTarget, cardId: killCardId });
          await applyAtom(state, { type: '询问闪', target: killTarget, source: target });
          const dodgeCardId = state.zones.processing.find(id => {
            const c = state.cardMap[id];
            return c && c.name === '闪';
          });
          if (dodgeCardId) {
            await applyAtom(state, {
              type: '移动牌',
              cardId: dodgeCardId,
              from: { zone: '处理区' },
              to: { zone: '弃牌堆' },
            });
          } else {
            await applyAtom(state, { type: '造成伤害', target: killTarget, amount: 1, source: target, cardId: killCardId });
          }
        }
      } else {
        // 不出:主公摸 1 张
        await applyAtom(state, { type: '摸牌', player: from, count: 1 });
      }
      popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '激将',
    style: 'primary',
    prompt: {
      type: 'choosePlayer',
      title: '激将：选择一名蜀势力角色出杀',
      min: 1,
      max: 1,
    },
  });
  return () => {};
}

