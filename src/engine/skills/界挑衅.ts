// 挑衅(界姜维·主动技,OL 界限突破官方逐字):
//   出牌阶段限一次,你可以选择一名攻击范围内包含我的角色,然后除非其对你使用一张
//   【杀】且此【杀】对你造成伤害,否则你弃置其一张牌,然后本阶段本技能限两次。
//
// 界限突破(相对标挑衅 src/engine/skills/挑衅.ts):
//   1. 标挑衅:每回合限一次;"出杀 OR 弃牌"(目标出杀即免于被弃,即使被闪抵消)。
//   2. 界挑衅:每阶段限两次;"出杀 + 此杀造成伤害"二者皆满足才免于被弃;
//      否则仍弃其一张牌。即目标出杀但被闪/防具/技能抵消未造成伤害,姜维依然弃其一张牌。
//
// 实现要点:
//   - 计数限两次:player.vars['界挑衅/usedThisTurn'] 存数字(1/2),沿用 /usedThisTurn
//     后缀由「回合结束」atom 自动清空。每次发动 +1,通过「回合用量」atom 同步 view.turnUsage。
//   - 伤害判定:捕获姜维 hp 快照,跑完整杀结算(出杀→询问闪→造成伤害),结算后比较 hp;
//     hp 未减 → 触发弃牌分支(出杀但未造成伤害也算)。
//   - 契约 key 与标挑衅完全隔离(界挑衅/选牌、界挑衅/弃牌目标、界挑衅/选牌结果、
//     界挑衅/usedThisTurn),与标挑衅同场共存无冲突。
//
// 命名:文件名/loader key/character skill name 均为 '界挑衅'(避开标挑衅冲突);
//   内部 Skill.name = '挑衅'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../index';
import { runUseFlow } from '../card-effect/use-card';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { inAttackRange } from '../distance';

const SKILL_ID = '界挑衅';
const DISPLAY_NAME = '挑衅';
/** 数字计数(1/2);沿用 /usedThisTurn 后缀由「回合结束」atom 自动清空。 */
const COUNT_KEY = `${SKILL_ID}/usedThisTurn`;
/** 被挑衅者出杀询问的 requestType(经 界挑衅/出杀 respond:选杀 + 指定目标=姜维)。 */
const SLASH_REQUEST = `${SKILL_ID}/出杀`;
/** 被挑衅者出杀选择写入的 localVars key。 */
const SLASH_CHOICE_VAR = `${SKILL_ID}/出杀选择`;
const PICK_REQUEST = `${SKILL_ID}/选牌`;
const PICK_VICTIM_KEY = `${SKILL_ID}/弃牌目标`;
const PICK_RESULT_KEY = `${SKILL_ID}/选牌结果`;
const MAX_USES = 2;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限两次:指定一名攻击范围包含你的角色,其须对你出杀且造成伤害,否则你弃其一张牌',
  };
}

/** 本回合已发动次数(0/1/2)。 */
function usesThisTurn(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars[COUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

/** 让姜维从被挑衅者区域选一张牌弃置(装备明选/手牌盲选)。 */
async function pickAndDiscard(state: GameState, picker: number, victim: number): Promise<void> {
  const vp = state.players[victim];
  if (!vp) return;
  const equipment = Object.entries(vp.equipment)
    .filter(([, id]) => typeof id === 'string')
    .map(([slot, id]) => ({
      slot,
      cardId: id as string,
      cardName: state.cardMap[id as string]?.name ?? '?',
    }));
  const handCount = vp.hand.length;
  if (equipment.length === 0 && handCount === 0) return; // 无牌可弃

  // 超时默认:明牌优先(装备首张),否则手牌[0]
  const defaultZone =
    equipment.length > 0
      ? { zone: 'equipment', cardId: equipment[0].cardId }
      : { zone: 'hand', handIndex: 0 };

  state.localVars[PICK_VICTIM_KEY] = victim;
  delete state.localVars[PICK_RESULT_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: PICK_REQUEST,
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

  const result = state.localVars[PICK_RESULT_KEY] as
    | { zone: string; cardId: string | null; handIndex: number | null }
    | undefined;
  delete state.localVars[PICK_RESULT_KEY];
  delete state.localVars[PICK_VICTIM_KEY];

  const zone = result?.zone ?? defaultZone.zone;
  let discardId: string | undefined;
  if (zone === 'equipment') {
    discardId = (result?.cardId ?? defaultZone.cardId) ?? undefined;
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

  // ─── use action:界姜维主动发动挑衅 ──────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(state)) return '当前有未完成的询问';
      if (usesThisTurn(state, ownerId) >= MAX_USES) return '本阶段挑衅已达上限(2次)';
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const target = params.target as number;
      if (typeof target !== 'number') return '需要选择目标';
      if (target === ownerId) return '不能选择自己';
      const targetPlayer = state.players[target];
      if (!targetPlayer?.alive) return '目标不存在或已死亡';
      // 目标必须能用杀攻击到姜维(即其攻击范围包含姜维)
      if (!inAttackRange(state, target, ownerId)) return '目标无法用杀攻击到你';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;

      // 计数 +1(同步设 vars + 回合用量 atom 投影 view,防 dispatch 重入)
      const nextCount = usesThisTurn(state, from) + 1;
      state.players[from].vars[COUNT_KEY] = nextCount;
      await applyAtom(state, {
        type: '回合用量',
        player: from,
        key: COUNT_KEY,
        value: nextCount,
      });

      await pushFrame(state, SKILL_ID, from, { ...params });

      try {
        // 1) 请求目标对姜维使用一张杀(经 界挑衅/出杀 respond:选杀 + 指定目标=姜维)。
        //    respond 注册到全座次,被问询方(target 座次)走 出杀 分支。
        await applyAtom(state, {
          type: '请求回应',
          requestType: SLASH_REQUEST,
          target,
          prompt: {
            type: 'useCardAndTarget',
            title: `挑衅:对 ${state.players[from].name} 使用一张杀(需造成伤害,否则其弃你一张牌)`,
            cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
            targetFilter: { min: 1, max: 1, filter: (_v, t) => t === from },
          },
          timeout: 15,
        });

        const choice = state.localVars[SLASH_CHOICE_VAR] as
          | { cardId: string; target: number }
          | undefined;
        delete state.localVars[SLASH_CHOICE_VAR];

        // 界版特殊:出杀 + 造成伤害才免于被弃。用 hp 快照判定(参考 界明策.virtualKill)。
        const hpBefore = state.players[from]?.health ?? 0;
        let slashed = false;
        if (choice?.cardId) {
          // 走完整杀结算(runUseFlow→杀.resolveSlash),目标固定=姜维;
          // damageType 由 cardMap 自动传导(火杀/雷杀不丢)。
          await runUseFlow(state, target, choice.cardId, [choice.target], '杀');
          slashed = true;
        }

        // 2) 关键差异(界):仅当杀对姜维造成伤害才免于被弃;否则仍弃其一张牌
        //    (含:未出杀 / 出杀被闪抵消 / 防具抵消 等情况,
        //     一律以 hp 净减少为准)
        const hpAfter = state.players[from]?.health ?? hpBefore;
        const damaged = hpAfter < hpBefore;
        if (!(slashed && damaged) && state.players[target]?.alive) {
          await pickAndDiscard(state, from, target);
        }
      } finally {
        await popFrame(state);
      }
    },
  );

  // ─── respond action:注册到全座次,按 requestType 分支 ────────────
  //   '界挑衅/出杀'(被挑衅者座次 ≠ ownerId):选一张杀 + 指定目标(固定=姜维)
  //   '界挑衅/选牌'(姜维座次 = ownerId):选弃哪张牌(装备明选/手牌盲选)
  //   参照 标挑衅/乱武:被问询者可能任意座次,须逐座次注册 respond 才能被 dispatch 路由。
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

          if (requestType === SLASH_REQUEST) {
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

          if (requestType === PICK_REQUEST) {
            // 姜维选弃哪张牌
            const victim = st.localVars[PICK_VICTIM_KEY] as number | undefined;
            if (typeof victim !== 'number') return '无弃牌目标';
            const vp = st.players[victim];
            if (!vp) return '弃牌目标不存在';
            const zone = params.zone;
            if (zone === 'equipment') {
              if (typeof params.cardId !== 'string') return 'cardId required';
              if (!Object.values(vp.equipment).includes(params.cardId)) return '该牌不在目标装备区';
              return null;
            }
            if (zone === 'hand') {
              if (typeof params.handIndex !== 'number') return 'handIndex required';
              if (params.handIndex < 0 || params.handIndex >= vp.hand.length) return 'handIndex 越界';
              return null;
            }
            return 'zone required (equipment|hand)';
          }

          return '当前不是挑衅询问';
        },
        async (st: GameState, params: Record<string, Json>) => {
          const slot = st.pendingSlots.get(seat);
          const requestType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (requestType === SLASH_REQUEST) {
            st.localVars[SLASH_CHOICE_VAR] = {
              cardId: params.cardId as string,
              target: params.target as number,
            };
          } else if (requestType === PICK_REQUEST) {
            st.localVars[PICK_RESULT_KEY] = {
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

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '挑衅:选择一名攻击范围包含你的角色',
      description: '其须对你出杀且造成伤害,否则你弃其一张牌(本阶段限两次)',
      targetFilter: {
        min: 1,
        max: 1,
        // 攻击范围检查:目标能用杀攻击到我(前端 UI 提示用,后端 validate 独立校验)
        filter: (view, t) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players[t];
          if (!tp || tp.alive === false) return false;
          return true;
        },
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const used = ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[COUNT_KEY];
      return (typeof used === 'number' ? used : 0) < MAX_USES;
    },
  });

  api.defineAction('respond', {
    label: DISPLAY_NAME,
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
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
