// 挑衅(姜维·主动技):出牌阶段限一次,你可以指定一名使用【杀】能攻击到你的角色,
//   该角色需对你使用一张【杀】,否则你弃其一张牌。
//
// 分析(步骤1):
//   类型:主动技 | 时机:出牌阶段 | 限制:每回合限一次
//   原子操作分解:
//     1. 回合用量(设 usedThisTurn,防重入 + 同步 view)
//     2. 请求回应(requestType='挑衅/出杀',target=被挑衅者,useCardAndTarget)
//        —— respond 注册到全座次,被问询者(被挑衅者座次)走 出杀 分支:
//           选一张【杀】+ 指定目标(固定=姜维),权威校验 inAttackRange。
//     3a. 目标出杀:useCard(quotaPolicy='none', mandatedTargets=[姜维]) 走完整杀结算
//         (runUseFlow→杀.resolveSlash),damageType 由 cardMap 自动传导(火杀/雷杀不丢)。
//     3b. 目标不出杀:请求回应(requestType='挑衅/选牌',target=姜维)让姜维选弃哪张牌
//         (pickTargetCard:装备明选 cardId / 手牌盲选 handIndex)→ 弃置该牌
//   钩子:无(纯主动技)
//   契约:读 localVars['挑衅/选牌']、['挑衅/弃牌目标']、['挑衅/出杀选择'];
//        写 player.vars['挑衅/usedThisTurn']
//   距离:inAttackRange(state, 目标, 姜维)—— 目标的杀能攻击到姜维
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { useCard } from '../card-effect/use-card';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending } from '../skill';
import { inAttackRange } from '../distance';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '挑衅',
    description: '出牌阶段限一次:指定一名能用杀攻击到你的角色,其须对你出杀,否则你弃其一张牌',
  };
}

/** 让姜维从被挑衅者区域选一张牌弃置(pickTargetCard:装备明选/手牌盲选)。 */
async function pickAndDiscard(state: GameState, picker: number, victim: number): Promise<void> {
  const vp = state.players[victim];
  if (!vp) return;
  const equipment = Object.entries(vp.equipment)
    .filter(([, id]) => typeof id === 'string')
    .map(([slot, id]) => ({ slot, cardId: id, cardName: state.cardMap[id]?.name ?? '?' }));
  const handCount = vp.hand.length;
  if (equipment.length === 0 && handCount === 0) return; // 无牌可弃

  // 超时默认:明牌优先(装备首张),否则手牌[0]
  const defaultZone =
    equipment.length > 0
      ? { zone: 'equipment', cardId: equipment[0].cardId }
      : { zone: 'hand', handIndex: 0 };

  state.localVars['挑衅/弃牌目标'] = victim;
  delete state.localVars['挑衅/选牌'];
  await applyAtom(state, {
    type: '请求回应',
    requestType: '挑衅/选牌',
    target: picker,
    prompt: {
      type: 'pickTargetCard',
      title: `挑衅:弃置 ${vp.name} 的一张牌`,
      target: victim,
      equipment,
      judge: [],
      handCount,
    },
    defaultChoice: defaultZone as unknown as Json,
    timeout: 20,
  });

  const result = state.localVars['挑衅/选牌'] as
    | { zone: string; cardId: string | null; handIndex: number | null }
    | undefined;
  delete state.localVars['挑衅/选牌'];
  delete state.localVars['挑衅/弃牌目标'];

  const zone = result?.zone ?? defaultZone.zone;
  let discardId: string | undefined;
  if (zone === 'equipment') {
    discardId = (result?.cardId ?? defaultZone.cardId);
  } else {
    // 手牌盲选
    const idx = result?.handIndex ?? 0;
    discardId = vp.hand[idx] ?? vp.hand[0];
  }
  if (discardId) {
    await applyAtom(state, { type: '弃置', player: victim, cardIds: [discardId] });
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── use action:姜维主动发动挑衅 ──────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(state)) return '当前有未完成的询问';
      if (usedThisTurn(state, ownerId, '挑衅')) return '本回合已使用过挑衅';
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const target = params.target as number;
      if (typeof target !== 'number') return '需要选择目标';
      if (target === ownerId) return '不能选择自己';
      const targetPlayer = state.players[target];
      if (!targetPlayer?.alive) return '目标不存在或已死亡';
      // 目标必须能用杀攻击到姜维
      if (!inAttackRange(state, target, ownerId)) return '目标无法用杀攻击到你';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(state, from, '挑衅');

      await pushFrame(state, '挑衅', from, { ...params });

      try {
        // 1) 请求目标对姜维使用一张杀(经 挑衅/出杀 respond:选杀 + 指定目标=姜维)。
        //    respond 注册到全座次,被问询方(target 座次)走 出杀 分支。
        await applyAtom(state, {
          type: '请求回应',
          requestType: '挑衅/出杀',
          target,
          prompt: {
            type: 'useCardAndTarget',
            title: `挑衅:对 ${state.players[from].name} 使用一张杀,否则其弃你一张牌`,
            cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
            targetFilter: { min: 1, max: 1, filter: (_v, t) => t === from },
          },
          timeout: 15,
        });

        const choice = state.localVars['挑衅/出杀选择'] as
          | { cardId: string; target: number }
          | undefined;
        delete state.localVars['挑衅/出杀选择'];

        if (choice?.cardId) {
          // 目标出了杀:走完整杀结算(useCard→runUseFlow→杀.resolveSlash),
          // 目标固定=姜维,mandatedTargets=[from] 强制;damageType 由 cardMap 自动传导。
          const err = await useCard(state, target, choice.cardId, [choice.target], {
            quotaPolicy: 'none',
            mandatedTargets: [from],
            skipValidate: true,
          });
          if (err) {
            // 防御兜底:目标选了杀但无效 → 走弃牌
            await pickAndDiscard(state, from, target);
          }
        } else {
          // 2) 目标没出杀:姜维弃其一张牌
          await pickAndDiscard(state, from, target);
        }
      } finally {
        await popFrame(state);
      }
    },
  );

  // ─── respond action:注册到全座次,按 requestType 分支 ────────────
  //   '挑衅/出杀'(被挑衅者座次 ≠ ownerId):选一张杀 + 指定目标(固定=姜维)
  //   '挑衅/选牌'(姜维座次 = ownerId):选弃哪张牌(装备明选/手牌盲选)
  //   参照 乱武/借刀杀人:被问询者可能任意座次,须逐座次注册 respond 才能被 dispatch 路由。
  const unloaders: Array<() => void> = [];
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          if (slot.atom.type !== '请求回应') return '当前不是挑衅询问';
          const requestType = (slot.atom as { requestType?: string }).requestType;

          if (requestType === '挑衅/出杀') {
            // 被挑衅者出杀:目标固定=姜维(ownerId),且须在攻击范围内
            const cardId = params.cardId as string | undefined;
            const targetIdx = params.target as number | undefined;
            if (typeof cardId !== 'string') return '请选择一张杀';
            if (typeof targetIdx !== 'number') return '请选择目标';
            const self = st.players[seat];
            if (!self?.hand.includes(cardId)) return '牌不在手牌中';
            if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
            if (targetIdx !== ownerId) return '只能对姜维使用杀';
            // 距离校验(权威,镜像 use validate):目标的杀能攻击到姜维
            if (!inAttackRange(st, seat, ownerId, cardId)) return '目标不在攻击范围内';
            return null;
          }

          if (requestType === '挑衅/选牌') {
            // 姜维选弃哪张牌
            const victim = st.localVars['挑衅/弃牌目标'] as number | undefined;
            if (typeof victim !== 'number') return '无弃牌目标';
            const vp = st.players[victim];
            if (!vp) return '弃牌目标不存在';
            const zone = params.zone;
            if (zone === 'equipment') {
              if (typeof params.cardId !== 'string') return 'cardId required';
              if (!Object.values(vp.equipment).includes(params.cardId))
                return '该牌不在目标装备区';
              return null;
            }
            if (zone === 'hand') {
              if (typeof params.handIndex !== 'number') return 'handIndex required';
              if (params.handIndex < 0 || params.handIndex >= vp.hand.length)
                return 'handIndex 越界';
              return null;
            }
            return 'zone required (equipment|hand)';
          }

          return '当前不是挑衅询问';
        },
        async (st: GameState, params: Record<string, Json>) => {
          const slot = st.pendingSlots.get(seat);
          const requestType = (
            slot?.atom as { requestType?: string } | undefined
          )?.requestType;
          if (requestType === '挑衅/出杀') {
            st.localVars['挑衅/出杀选择'] = {
              cardId: params.cardId as string,
              target: params.target as number,
            };
          } else if (requestType === '挑衅/选牌') {
            st.localVars['挑衅/选牌'] = {
              zone: params.zone,
              cardId: params.cardId ?? null,
              handIndex: params.handIndex ?? null,
            };
          }
        },
      ),
    );
  }

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '挑衅',
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '挑衅:选择一名能用杀攻击到你的角色',
      description: '其须对你出杀,否则你弃其一张牌',
      targetFilter: {
        min: 1,
        max: 1,
        // 攻击范围检查:目标能用杀攻击到我(前端 UI 提示用,后端 validate 独立校验)
        filter: (view, t) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players[t];
          if (!tp || tp.alive === false) return false;
          // 复用前端可见距离推断(近似后端 inAttackRange)
          return true;
        },
      },
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn('挑衅')(ctx),
  });

  api.defineAction('respond', {
    label: '挑衅',
    style: 'primary',
    prompt: {
      type: 'pickTargetCard',
      title: '挑衅:选择弃置的牌',
      target: 0,
      equipment: [],
      judge: [],
      handCount: 0,
    },
  });
}

export default { createSkill, onInit, onMount };
