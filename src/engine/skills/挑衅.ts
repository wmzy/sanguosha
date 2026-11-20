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
//     3a. 目标出杀:runUseFlow(none) 走完整杀结算
//         (runUseFlow→杀.resolveSlash),damageType 由 cardMap 自动传导(火杀/雷杀不丢)。
//     3b. 目标不出杀:选牌面板(runPickTargetCardPanel discard 模式,过河拆桥同款)
//         让姜维选弃哪张牌(装备明选 cardId / 手牌盲选 handIndex)→ 弃置该牌
//   钩子:无(纯主动技)
//   契约:写 localVars['选牌/结果'](选牌面板)与['挑衅/弃牌目标']、['挑衅/出杀选择'];
//        读 player.vars['挑衅/usedThisTurn']
//   距离:inAttackRange(state, 目标, 姜维)—— 目标的杀能攻击到姜维
//
// 本文件同时导出 createTiaoxinSkill 工厂(挑衅族共享实现),界挑衅 复用之:
// use/respond 全流程、选牌面板、onMount 逐字共享,仅 限次策略(limitError/markUse)、
// 出杀后是否需造成伤害(requireDamage)、文案/键前缀 经 opts 注入
// (界版用回 '界挑衅/' 前缀键,与标版键空间隔离,同场共存无冲突)。
import type {
  ActionContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { runUseFlow } from './cards/use-card';
import { registerAction, hasBlockingPending } from '../core/skill';
import { runPickTargetCardPanel } from '../flows/pick-card-panel';
import { PICK_RESULT_KEY } from '../rules/vars-keys';
import { currentRequestType, requireRequestType, registerRespondForAllSeats } from '../util/skillRuntime';
import { panelEquipmentAllowed } from './cards/_pickPanel';
import { inAttackRange } from '../rules/distance';
import { viewCanAttack } from '../rules/viewDistance';
import {
  usedThisTurn,
  markOncePerTurn,
  activeUnlessUsedThisTurn,
} from '../rules/once-per-turn';

// localVars 键 / requestType 常量(对齐 乱武/借刀杀人 风格)
const REQUEST_TYPE = '挑衅/出杀'; // 出杀询问的 requestType
const CHOICE_VAR = '挑衅/出杀选择'; // 出杀选择写入的 localVars key
const PICK_REQUEST_TYPE = '挑衅/选牌'; // 选牌询问的 requestType
const DISCARD_TARGET_VAR = '挑衅/弃牌目标';

/** 挑衅族(主动技)差异参数 */
export interface TiaoxinOptions {
  /** 技能 id('挑衅'/'界挑衅'):frame 名 */
  skillId: string;
  description: string;
  /** 出杀询问 requestType('挑衅/出杀'/'界挑衅/出杀') */
  slashRt: string;
  /** 出杀选择 localVars key */
  slashChoiceKey: string;
  /** 选牌询问 requestType */
  pickRt: string;
  /** 弃牌目标 localVars key(respond validate 定位被挑衅者) */
  discardTargetKey: string;
  /** 出杀询问标题(两版文案不同:界版注明"需造成伤害") */
  slashPromptTitle: (targetName: string) => string;
  /** use validate 的限次检查(返回错误文案;null=未达上限) */
  limitError: (state: GameState, ownerId: number) => string | null;
  /** use execute 的计次副作用(标 markOncePerTurn / 界 setPlayerVarUsage 计数) */
  markUse: (state: GameState, ownerId: number) => Promise<void>;
  /** 界版:仅当出杀且对姜维造成伤害才免于被弃(标版不传:出杀即免) */
  requireDamage?: boolean;
  /** onMount use action 弹窗标题 */
  useTitle: string;
  /** onMount use action 弹窗说明 */
  useDescription: string;
  /** onMount use action 激活条件 */
  activeWhen: (ctx: ActionContext) => boolean;
}

/** 让姜维从被挑衅者区域选一张牌弃置(选牌面板 discard 模式:装备明选/手牌盲选)。 */
async function pickAndDiscard(
  state: GameState,
  picker: number,
  victim: number,
  pickRt: string,
  discardTargetKey: string,
): Promise<void> {
  const vp = state.players[victim];
  if (!vp) return;
  const hasEquipment = Object.values(vp.equipment).some((id) => typeof id === 'string');
  if (!hasEquipment && vp.hand.length === 0) return; // 无牌可弃

  // respond 校验经 discardTargetKey 定位被挑衅者(见下方 respond 的 选牌 分支)
  state.localVars[discardTargetKey] = victim;
  delete state.localVars[PICK_RESULT_KEY];
  try {
    await runPickTargetCardPanel(state, picker, victim, vp, {
      mode: 'discard',
      requestType: pickRt,
      title: `挑衅:弃置 ${vp.name} 的一张牌`,
      includeJudge: false,
    });
  } finally {
    delete state.localVars[discardTargetKey];
  }
}

/** 挑衅族共享实现:标版挑衅与界挑衅的 use/respond 全流程逐字一致;
 *  限次策略与出杀后的弃牌判定经 opts 注入。 */
export function createTiaoxinSkill(opts: TiaoxinOptions) {
  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: '挑衅',
        description: opts.description,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
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
          const limitError = opts.limitError(state, ownerId);
          if (limitError) return limitError;
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

          // 限一次标记(标:同步设 vars + 回合用量 atom 投影 view;界:计数 +1)。
          // 防 dispatch 重入:必须在第一个 await(pushFrame)之前。
          await opts.markUse(state, from);

          await pushFrame(state, opts.skillId, from, { ...params });

          try {
            // 1) 请求目标对姜维使用一张杀(经 出杀 respond:选杀 + 指定目标=姜维)。
            //    respond 注册到全座次,被问询方(target 座次)走 出杀 分支。
            await applyAtom(state, {
              type: '请求回应',
              requestType: opts.slashRt,
              target,
              prompt: {
                type: 'useCardAndTarget',
                title: opts.slashPromptTitle(state.players[from].name),
                cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
                targetFilter: { min: 1, max: 1, filter: (_v, t) => t === from },
              },
              timeout: 15,
            });

            const choice = state.localVars[opts.slashChoiceKey] as
              | { cardId: string; target: number }
              | undefined;
            delete state.localVars[opts.slashChoiceKey];

            // 界版特殊:出杀 + 造成伤害才免于被弃。用 hp 快照判定(参考 界明策.virtualKill)。
            const hpBefore = state.players[from]?.health ?? 0;
            let slashed = false;
            if (choice?.cardId) {
              // 走完整杀结算(runUseFlow→杀.resolveSlash),目标固定=姜维;
              // damageType 由 cardMap 自动传导(火杀/雷杀不丢)。
              await runUseFlow(state, target, choice.cardId, [choice.target], '杀');
              slashed = true;
            }

            if (opts.requireDamage) {
              // 2) 关键差异(界):仅当杀对姜维造成伤害才免于被弃;否则仍弃其一张牌
              //    (含:未出杀 / 出杀被闪抵消 / 防具抵消 等情况,一律以 hp 净减少为准)
              const hpAfter = state.players[from]?.health ?? hpBefore;
              const damaged = hpAfter < hpBefore;
              if (!(slashed && damaged) && state.players[target]?.alive) {
                await pickAndDiscard(state, from, target, opts.pickRt, opts.discardTargetKey);
              }
            } else if (!slashed) {
              // 2) 目标没出杀:姜维弃其一张牌
              await pickAndDiscard(state, from, target, opts.pickRt, opts.discardTargetKey);
            }
          } finally {
            await popFrame(state);
          }
        },
      );

      // ─── respond action:注册到全座次,按 requestType 分支 ────────────
      //   出杀(被挑衅者座次 ≠ ownerId):选一张杀 + 指定目标(固定=姜维)
      //   选牌(姜维座次 = ownerId):选弃哪张牌(装备明选/手牌盲选)
      //   参照 乱武/借刀杀人:被问询者可能任意座次,须逐座次注册 respond 才能被 dispatch 路由。
      const unloaders = registerRespondForAllSeats(
        state,
        skill.id,
        (st: GameState, seat: number, params: Record<string, Json>): string | null => {
          const check = requireRequestType(st, seat, [opts.slashRt, opts.pickRt], {
            wrongTypeError: '当前不是挑衅询问',
            mismatchError: '当前不是挑衅询问',
          });
          if (check.error) return check.error;
          const requestType = check.requestType;
          const slot = st.pendingSlots.get(seat)!;

          if (requestType === opts.slashRt) {
            // 被挑衅者出杀:目标固定=姜维(ownerId),且须在攻击范围内
            const cardId = params.cardId as string | undefined;
            // 前端 useCardAndTarget 回应发 targets:[idx] 数组;直接 dispatch 兼容单数 target
            const rawTarget = Array.isArray(params.targets)
              ? (params.targets as unknown[])[0]
              : params.target;
            const targetIdx = typeof rawTarget === 'number' ? rawTarget : undefined;
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

          if (requestType === opts.pickRt) {
            // 姜维选弃哪张牌
            const victim = st.localVars[opts.discardTargetKey] as number | undefined;
            if (typeof victim !== 'number') return '无弃牌目标';
            const vp = st.players[victim];
            if (!vp) return '弃牌目标不存在';
            const zone = params.zone;
            if (zone === 'equipment') {
              if (typeof params.cardId !== 'string') return 'cardId required';
              // 界奇才 hook 可能已从 prompt.equipment 过滤受保护装备(防具/宝物);
              // 判据与 过河拆桥/顺手牵羊 共源(cards/_pickPanel)
              if (!panelEquipmentAllowed(slot.atom, params.cardId)) return '该装备不可选';
              if (!Object.values(vp.equipment).includes(params.cardId)) return '该牌不在目标装备区';
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
        async (st: GameState, seat: number, params: Record<string, Json>) => {
          const requestType = currentRequestType(st, seat);
          if (requestType === opts.slashRt) {
            // 与 validate 同构:前端 targets 数组优先,兼容单数 target
            const rawTarget = Array.isArray(params.targets)
              ? (params.targets as unknown[])[0]
              : params.target;
            st.localVars[opts.slashChoiceKey] = {
              cardId: params.cardId as string,
              target: rawTarget as number,
            };
          } else if (requestType === opts.pickRt) {
            // pickTargetCard respond → 选牌/结果(由 runPickTargetCardPanel 读取)
            st.localVars[PICK_RESULT_KEY] = {
              zone: params.zone,
              cardId: params.cardId ?? null,
              handIndex: params.handIndex ?? null,
            };
          }
        },
      );

      return () => {
        for (const u of unloaders) u();
      };
    },

    onMount(_skill: Skill, api: FrontendAPI): (() => void) | undefined {
      api.defineAction('use', {
        label: '挑衅',
        style: 'danger',
        prompt: {
          type: 'selectTarget',
          title: opts.useTitle,
          description: opts.useDescription,
          targetFilter: {
            min: 1,
            max: 1,
            // 攻击范围检查:目标能用杀攻击到我 —— 与后端 inAttackRange 同源的 view 侧判据。
            // 旧实现是占位 `return true` → 枚举出打不到我的角色,提交被引擎 validate 拒
            // (玩家点了没反应 / AI 反复挑中同一非法目标空转)。
            filter: (view, t) => {
              const me = view.currentPlayerIndex;
              if (t === me) return false;
              const tp = view.players[t];
              if (!tp || tp.alive === false) return false;
              return viewCanAttack(view.players, t, me);
            },
          },
        },
        activeWhen: (ctx: ActionContext) => opts.activeWhen(ctx),
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
      return undefined;
    },
  };
}

const OPTIONS: TiaoxinOptions = {
  skillId: '挑衅',
  description: '出牌阶段限一次:指定一名能用杀攻击到你的角色,其须对你出杀,否则你弃其一张牌',
  slashRt: REQUEST_TYPE,
  slashChoiceKey: CHOICE_VAR,
  pickRt: PICK_REQUEST_TYPE,
  discardTargetKey: DISCARD_TARGET_VAR,
  slashPromptTitle: (targetName) =>
    `挑衅:对 ${targetName} 使用一张杀,否则其弃你一张牌`,
  limitError: (state, ownerId) =>
    usedThisTurn(state, ownerId, '挑衅') ? '本回合已使用过挑衅' : null,
  markUse: (state, ownerId) => markOncePerTurn(state, ownerId, '挑衅'),
  useTitle: '挑衅:选择一名能用杀攻击到你的角色',
  useDescription: '其须对你出杀,否则你弃其一张牌',
  activeWhen: activeUnlessUsedThisTurn('挑衅'),
};

export const { createSkill, onInit, onMount } = createTiaoxinSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;

// [requestType 迁移·不迁项] respond 校验里的 slot.atom 另传给 panelEquipmentAllowed
// (界奇才 受保护装备过滤,非 requestType),保留手写 pendingSlots.get;
// requestType 读取已全部走 currentRequestType。
