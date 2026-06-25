// 借刀杀人(普通锦囊):
//   出牌阶段,对装备区有武器牌的 1 名其他角色(A)使用。
//   A 须选择:对使用者指定的另一名角色 B 使用 1 张杀,或交出武器。
//   请求回应 后检查处理区:有杀 = 出了杀;没有 = 不出(获得武器)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill'
import { viewCanAttack } from '../viewDistance';
import { askWuxie } from '../wuxie';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '借刀杀人', description: '锦囊:令目标出杀或获得其武器' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state)
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      // 兼容两种目标格式:
      //   1) params.target + params.killTarget(显式两字段,旧契约)
      //   2) params.targets = [A, B](复数数组,与其他多目标牌对齐)
      let targetIdx: number | undefined;
      let killTargetIdx: number | undefined;
      if (Array.isArray(params.targets) && (params.targets as unknown[]).length >= 2
        && typeof (params.targets as unknown[])[0] === 'number'
        && typeof (params.targets as unknown[])[1] === 'number') {
        const arr = params.targets as number[];
        targetIdx = arr[0];
        killTargetIdx = arr[1];
      } else {
        if (typeof params.target === 'number') targetIdx = params.target;
        if (typeof params.killTarget === 'number') killTargetIdx = params.killTarget;
      }
      if (typeof targetIdx !== 'number') return 'target required';
      if (typeof killTargetIdx !== 'number') return 'killTarget required';
      const cardInHand = !!self.hand.includes(params.cardId);
      const cardNameOk = state.cardMap[params.cardId]?.name === '借刀杀人';
      const target = state.players[targetIdx];
      const targetAlive = target?.alive === true;
      const targetHasWeapon = !!target?.equipment['武器'];
      const notSelf = targetIdx !== ownerId;
      const killTargetPlayer = state.players[killTargetIdx];
      const killTargetAlive = killTargetPlayer?.alive === true;
      const killTargetNotOwner = killTargetIdx !== ownerId;
      const killTargetNotTarget = killTargetIdx !== targetIdx;
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk
        && targetAlive && targetHasWeapon && notSelf
        && killTargetAlive && killTargetNotOwner && killTargetNotTarget;
      return ok ? null : '借刀杀人使用条件不满足';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      // 兼容两种目标格式:与 validate 对齐
      let target: number;
      let killTarget: number;
      if (Array.isArray(params.targets) && (params.targets as unknown[]).length >= 2
        && typeof (params.targets as unknown[])[0] === 'number'
        && typeof (params.targets as unknown[])[1] === 'number') {
        const arr = params.targets as number[];
        target = arr[0];
        killTarget = arr[1];
      } else {
        target = params.target as number;
        killTarget = params.killTarget as number;
      }
      await pushFrame(state, '借刀杀人', from, { ...params });

      // 锦囊进处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });

      // 询问无懈可击(单目标锦囊:抵消整个锦囊)
      try {
        const cancelled = await askWuxie(state, target);
        if (!cancelled) {
          // 请求回应:目标选择出杀或交出武器
          // 使用 useCard 提示让目标选择一张杀牌;选中的杀通过 杀.respond 移入处理区
          await applyAtom(state, {
            type: '请求回应',
            requestType: '杀/forceKill',
            target,
            prompt: { type: 'useCard', title: '借刀杀人:请打出一张杀', cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 } },
            timeout: 15,
          });

          // 检查处理区:有杀 = 出了杀
          const killCardId = state.zones.processing.find(id => {
            const c = state.cardMap[id];
            return c && c.name === '杀';
          });

          if (killCardId) {
            // 目标出了杀:移到弃牌堆,执行杀的效果(对 killTarget 询问闪)
            await applyAtom(state, {
              type: '移动牌',
              cardId: killCardId,
              from: { zone: '处理区' },
              to: { zone: '弃牌堆' },
            });
            await applyAtom(state, { type: '指定目标', source: target, target: killTarget, cardId: killCardId });
            await applyAtom(state, { type: '询问闪', target: killTarget, source: target });
            // 检查处理区:有闪 = 出了闪,没闪 = 伤害
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
          } else {
            // 不出杀:获得目标的武器
            const targetPlayer = state.players[target];
            const weaponId = targetPlayer.equipment['武器'];
            if (weaponId) {
              await applyAtom(state, { type: '卸下', player: target, slot: '武器' });
              await applyAtom(state, { type: '获得', player: from, cardId: weaponId, from: target });
            }
          }
        }
        // 锦囊移出处理区→弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        // 异常时保证处理区清理与状态恢复
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        await popFrame(state);
      }
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '借刀杀人',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '借刀杀人',
      cardFilter: { filter: (c) => c.name === '借刀杀人', min: 1, max: 1 },
      // 两槽位目标:A = 装备区有武器的角色;B = 在 A 出杀范围内的角色(依赖 A)。
      // filter 仅为前端 UI 提示,后端 validate 已独立校验全部条件。
      targetFilter: {
        min: 2, max: 2,
        slots: [
          { label: '持武器者', filter: (view, t) => !!view.players[t]?.equipment?.['武器'] },
          { label: '被杀者', filter: (view, t, ctx) => viewCanAttack(view.players, view.cardMap, ctx.selected[0], t) },
        ],
      },
    },
  });
}

