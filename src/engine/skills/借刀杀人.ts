// 借刀杀人(普通锦囊):
//   出牌阶段,对装备区有武器牌的 1 名其他角色(A)使用。
//   A 须选择:对使用者指定的另一名角色 B 使用 1 张杀,或交出武器。
//
// 结算逻辑已迁移到 card-effects/借刀杀人.ts (CardEffect.resolve)。
// execute 委托 runUseFlow 编排完整使用结算流程（文档 use.md）。
//
// 双目标传递：targets=[A]（武器持有者），killTarget=B 存入 localVars 供 resolve 读取。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, hasBlockingPending } from '../skill';
import { runUseFlow } from '../card-effect/use-card';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '借刀杀人', description: '锦囊:令目标出杀或获得其武器' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      // 兼容两种目标格式:
      //   1) params.targets = [A, B](复数数组,与其他多目标牌对齐)
      //   2) params.target + params.killTarget(显式两字段,旧契约)
      let targetIdx: number | undefined;
      let killTargetIdx: number | undefined;
      if (
        Array.isArray(params.targets) &&
        (params.targets as unknown[]).length >= 2 &&
        typeof (params.targets as unknown[])[0] === 'number' &&
        typeof (params.targets as unknown[])[1] === 'number'
      ) {
        const arr = params.targets as number[];
        targetIdx = arr[0];
        killTargetIdx = arr[1];
      } else {
        targetIdx = params.target as number | undefined;
        killTargetIdx = params.killTarget as number | undefined;
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
      const ok =
        myTurn &&
        inActPhase &&
        free &&
        selfAlive &&
        cardInHand &&
        cardNameOk &&
        targetAlive &&
        targetHasWeapon &&
        notSelf &&
        killTargetAlive &&
        killTargetNotOwner &&
        killTargetNotTarget;
      return ok ? null : '借刀杀人使用条件不满足';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 兼容两种目标格式:与 validate 对齐
      let target: number;
      let killTarget: number;
      if (
        Array.isArray(params.targets) &&
        (params.targets as unknown[]).length >= 2 &&
        typeof (params.targets as unknown[])[0] === 'number' &&
        typeof (params.targets as unknown[])[1] === 'number'
      ) {
        const arr = params.targets as number[];
        target = arr[0];
        killTarget = arr[1];
      } else {
        target = params.target as number;
        killTarget = params.killTarget as number;
      }
      // killTarget 存入 localVars 供 card-effect resolve 读取
      state.localVars['借刀杀人/killTarget'] = killTarget;
      // runUseFlow 的 targets 是武器持有者 A（单目标）
      await runUseFlow(state, ownerId, cardId, [target], '借刀杀人');
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '借刀杀人',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '借刀杀人',
      cardFilter: { filter: (c) => c.name === '借刀杀人', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
}
