// src/engine/skills/神速.ts
// 神速(夏侯渊):你可以选择至多三项:
//   1. 跳过判定阶段和摸牌阶段;视为对一名其他角色使用一张无距离限制的【杀】。
//   2. 跳过出牌阶段并弃置一张装备牌;视为对一名其他角色使用一张无距离限制的【杀】。
//   3. 跳过弃牌阶段并翻面;视为对一名其他角色使用一张无距离限制的【杀】。
//
// 实现要点:
//   - 选项1 在 阶段开始(判定) before-hook 询问发动;发动则加 跳过摸牌 标签 + 虚拟杀 + cancel 判定。
//   - 选项2 在 阶段开始(出牌) before-hook 询问发动;发动则弃装备 + 虚拟杀 + cancel 出牌。
//   - 选项3 在 阶段开始(弃牌) before-hook 询问发动;发动则加 翻面 标签 + 虚拟杀 + cancel 弃牌。
//   - 虚拟杀:无实体卡,走 runUseFlow(virtual) + chargeOnSettle→ 指定目标→成为目标→检测有效性→询问闪→
//     (被抵消|造成伤害) 流程,与 杀.use 的结算段一致。不消耗手牌、计入出杀次数(视为使用杀,
//     由 chargeOnSettle 的 onSettle 计数;与界仁德/界乱武 自用虚拟杀一致)。
//   - 跳过阶段手法同兵粮寸断/乐不思蜀:applyAtom(阶段结束, 当前阶段) 推进到下一阶段,再 cancel。
//   - 翻面实现(同据守/放逐/界神速):加 '/翻面' 后缀标签,下一回合 阶段开始(准备) before-hook
//     消费标签、设 skipAll 标志并 cancel 阶段;阶段结束(准备) before-hook 亲自推进回合。
import type {
  AtomBeforeContext,
  AtomOfName,
  FrontendAPI,
  GameState,
  GameView,
  HookResult,
  PlayerState,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction } from '../core/skill';
import { registerFlipSkipTurnHooks } from '../flows/face-down';
import {
  requireRequestType,
  askConfirm,
  firstCardId,
  firstTarget,
  registerPhaseStartHook,
  defineConfirmAction,
} from '../util/skillRuntime';
import { equipmentCardIds } from '../util/player-query';
import { runVirtualSlash } from './cards/_virtualSlash';
import { skipPhase } from '../rules/skip-phase';

const OPT1_TRIGGER_RT = '神速/opt1-trigger';
const OPT1_TARGET_RT = '神速/opt1-target';
const OPT2_TRIGGER_RT = '神速/opt2-trigger';
const OPT2_TARGET_RT = '神速/opt2-target';
const OPT2_EQUIP_RT = '神速/opt2-equip';
const OPT3_TRIGGER_RT = '神速/opt3-trigger';
const OPT3_TARGET_RT = '神速/opt3-target';
// 标签/标志(界神速 共用同一批 '神速/' 前缀键,由本文件导出)
export const SKIP_MO_TAG = '神速/跳过摸牌';
export const SKIP_PLAY_TAG = '神速/跳过出牌';
export const FLIP_TAG = '神速/翻面'; // 翻面标签(下一回合被消费,跳过整回合)
// per-turn 标记(后缀 /usedThisTurn 由 回合结束 atom 自动清理)
const OPT1_USED_KEY = '神速/opt1/usedThisTurn';
const OPT2_USED_KEY = '神速/opt2/usedThisTurn';
const OPT3_USED_KEY = '神速/opt3/usedThisTurn';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '神速',
    description:
      '可选择至多三项:①跳过判定+摸牌;②弃装备+跳过出牌;③翻面+跳过弃牌。每项视为出杀',
  };
}

// ── 神速/界神速 共享机制(界版从本文件 import) ─────────────────

/** 主询问 hook 的入口守卫:本人回合的指定阶段(判定/出牌/弃牌)开始、本人存活、
 *  本回合未发动过(usedKey)且存在其他存活角色(视为出杀要有目标)→ 返回 {atom, self};
 *  否则返回 null,调用方直接 return(阶段正常进行)。 */
export function shensuPhaseEntry(
  ctx: AtomBeforeContext,
  ownerId: number,
  phase: '判定' | '出牌' | '弃牌',
  usedKey: string,
): { atom: AtomOfName<'阶段开始'>; self: PlayerState } | null {
  const atom = ctx.atom;
  if (atom.type !== '阶段开始') return null;
  if (atom.player !== ownerId) return null;
  if (atom.phase !== phase) return null;
  if (ctx.state.currentPlayerIndex !== ownerId) return null;
  const self = ctx.state.players[ownerId];
  if (!self?.alive) return null;
  if (self.vars[usedKey]) return null;
  // 无其他存活角色 → 视为出杀无目标,神速无意义
  const hasOtherAlive = ctx.state.players.some((p, i) => i !== ownerId && p.alive);
  if (!hasOtherAlive) return null;
  return { atom, self };
}

/** 注册「有标签 → 跳过对应阶段」的 阶段开始 before-hook(标签型跳过,同兵粮寸断/乐不思蜀):
 *  命中标签时 去标签 + 阶段结束(当前阶段) + cancel。 */
export function registerShensuTagSkipHook(
  state: GameState,
  skillId: string,
  ownerId: number,
  phase: string,
  tag: string,
): void {
  registerPhaseStartHook(
    state,
    skillId,
    ownerId,
    phase,
    async (ctx): Promise<HookResult | void> => {
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(tag)) return;
      // 标签型跳过:去标签 + 阶段结束(当前阶段) + cancel
      return skipPhase(ctx.state, ctx.atom, tag);
    },
  );
}

/** 神速族发动确认询问(标/界共用):confirmedKey 固定 '神速/confirmed',
 *  发动/不发动 二选,默认不发动(超时=不发动),10s 超时。 */
export async function askShensuConfirm(
  state: GameState,
  ownerId: number,
  requestType: string,
  title: string,
): Promise<boolean> {
  return askConfirm(state, requestType, ownerId, {
    confirmedKey: '神速/confirmed',
    title,
    confirmLabel: '发动',
    cancelLabel: '不发动',
    defaultChoice: false,
    timeout: 10,
  });
}

/** 神速族询问虚拟杀目标:choosePlayer 选一名其他存活角色,读回 '神速/target' 后清理。
 *  requestType 由调用方传入(标版 OPT1/2/3_TARGET_RT / 界版 '界神速/target');
 *  存在其他存活角色的前置守卫由 shensuPhaseEntry 保证(无目标则整个 hook 不触发)。 */
export async function askShensuKillTarget(
  state: GameState,
  ownerId: number,
  requestType: string,
  label: string,
): Promise<number | undefined> {
  delete state.localVars['神速/target'];
  await applyAtom(state, {
    type: '请求回应',
    requestType,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: `${label}:选择一名其他角色(视为出杀,无距离限制)`,
      min: 1,
      max: 1,
      filter: (_view: GameView, t: number) => t !== ownerId && state.players[t]?.alive === true,
    },
    timeout: 15,
  });
  const t = state.localVars['神速/target'] as number | undefined;
  delete state.localVars['神速/target'];
  return t;
}

/** 神速族虚拟杀:target 为数字且仍存活才执行,统一 charge:true(视为使用杀,计入出杀次数)。
 *  prefix=虚拟卡 id 前缀(技能名:标 '神速' / 界 '界神速')。 */
export async function runShensuVirtualSlash(
  state: GameState,
  ownerId: number,
  target: number | undefined,
  prefix: string,
): Promise<void> {
  if (typeof target === 'number' && state.players[target]?.alive) {
    await runVirtualSlash(state, ownerId, target, { prefix, charge: true });
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理所有 神速 相关的 trigger/target/equip 询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s): string | null =>
      requireRequestType(
        s,
        ownerId,
        [
          OPT1_TRIGGER_RT,
          OPT1_TARGET_RT,
          OPT2_TRIGGER_RT,
          OPT2_TARGET_RT,
          OPT2_EQUIP_RT,
          OPT3_TRIGGER_RT,
          OPT3_TARGET_RT,
        ],
        { mismatchError: '当前不是神速询问' },
      ).error,
    async (s, params) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType ?? '';
      if (rt === OPT1_TRIGGER_RT || rt === OPT2_TRIGGER_RT || rt === OPT3_TRIGGER_RT) {
        s.localVars['神速/confirmed'] = params.choice === true;
      } else if (rt === OPT1_TARGET_RT || rt === OPT2_TARGET_RT || rt === OPT3_TARGET_RT) {
        const t = firstTarget(params);
        if (typeof t === 'number') s.localVars['神速/target'] = t;
      } else if (rt === OPT2_EQUIP_RT) {
        // 兼容 distribute/select 的 cardIds 数组与单 cardId
        s.localVars['神速/equipCardId'] = firstCardId(params) ?? null;
      }
    },
  );

  // ── 选项1:阶段开始(判定) before-hook ──────────────────────────
  registerPhaseStartHook(
    state,
    skill.id,
    ownerId,
    '判定',
    async (ctx): Promise<HookResult | void> => {
      const entry = shensuPhaseEntry(ctx, ownerId, '判定', OPT1_USED_KEY);
      if (!entry) return;
      const { atom, self } = entry;

      // 询问是否发动选项1
      if (
        !(await askShensuConfirm(ctx.state, ownerId, OPT1_TRIGGER_RT, '是否发动神速①?(跳过判定+摸牌,视为出杀)'))
      ) {
        return; // 不发动 → 判定阶段正常进行
      }

      // 选目标
      const target = await askShensuKillTarget(ctx.state, ownerId, OPT1_TARGET_RT, '神速①');

      // 标记选项1已使用 + 加跳过摸牌标签
      self.vars[OPT1_USED_KEY] = true;
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_MO_TAG });

      // 虚拟杀
      await runShensuVirtualSlash(ctx.state, ownerId, target, '神速');

      // 跳过判定阶段(直接型):阶段结束(判定)+ cancel
      return skipPhase(ctx.state, atom);
    },
    { requireCurrentPlayer: true },
  );

  // ── 选项2:阶段开始(出牌) before-hook ──────────────────────────
  registerPhaseStartHook(
    state,
    skill.id,
    ownerId,
    '出牌',
    async (ctx): Promise<HookResult | void> => {
      const entry = shensuPhaseEntry(ctx, ownerId, '出牌', OPT2_USED_KEY);
      if (!entry) return;
      const { atom, self } = entry;

      // 发动条件:有装备牌(其他存活角色守卫在 shensuPhaseEntry 内)
      const equipCount = equipmentCardIds(self).length;
      if (equipCount === 0) return;

      // 询问是否发动选项2
      if (
        !(await askShensuConfirm(ctx.state, ownerId, OPT2_TRIGGER_RT, '是否发动神速②?(弃置一张装备牌,跳过出牌,视为出杀)'))
      ) {
        return; // 不发动 → 出牌阶段正常进行
      }

      // 选要弃的装备牌(用 distribute/select 从装备区选 1 张)
      delete ctx.state.localVars['神速/equipCardId'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT2_EQUIP_RT,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: '神速②:选择一张装备牌弃置',
          source: 'handAndEquip',
          minTotal: 1,
          maxTotal: 1,
        },
        timeout: 15,
      });
      const equipCardId = ctx.state.localVars['神速/equipCardId'] as string | undefined;
      delete ctx.state.localVars['神速/equipCardId'];
      if (!equipCardId || !Object.values(self.equipment).includes(equipCardId)) {
        return; // 无效选择 → 出牌阶段正常进行
      }

      // 选目标
      const target = await askShensuKillTarget(ctx.state, ownerId, OPT2_TARGET_RT, '神速②');

      // 标记选项2已使用(出牌阶段由下方 skipPhase 直接跳过,无需再加标签;
      // 否则标签残留到下回合会被「跳过出牌」hook 误消费,导致下回合出牌阶段被错误跳过)
      self.vars[OPT2_USED_KEY] = true;

      // 弃置装备牌
      await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [equipCardId], voluntary: true });

      // 虚拟杀
      await runShensuVirtualSlash(ctx.state, ownerId, target, '神速');

      // 跳过出牌阶段(直接型):阶段结束(出牌)+ cancel
      return skipPhase(ctx.state, atom);
    },
    { requireCurrentPlayer: true },
  );

  // ── 跳过摸牌阶段:有标签 → skip(同兵粮寸断) ──────────────────
  registerShensuTagSkipHook(state, skill.id, ownerId, '摸牌', SKIP_MO_TAG);

  // ── 跳过出牌阶段:有标签 → skip(同乐不思蜀) ──────────────────
  registerShensuTagSkipHook(state, skill.id, ownerId, '出牌', SKIP_PLAY_TAG);

  // ── 选项3:阶段开始(弃牌) before-hook ──────────────────────────
  registerPhaseStartHook(
    state,
    skill.id,
    ownerId,
    '弃牌',
    async (ctx): Promise<HookResult | void> => {
      const entry = shensuPhaseEntry(ctx, ownerId, '弃牌', OPT3_USED_KEY);
      if (!entry) return;
      const { atom, self } = entry;

      // 询问是否发动选项3
      if (
        !(await askShensuConfirm(ctx.state, ownerId, OPT3_TRIGGER_RT, '是否发动神速③?(翻面,跳过弃牌,视为出杀)'))
      ) {
        return; // 不发动 → 弃牌阶段正常进行
      }

      // 选目标
      const target = await askShensuKillTarget(ctx.state, ownerId, OPT3_TARGET_RT, '神速③');

      // 标记选项3已使用 + 加翻面标签(下一回合被消费)
      self.vars[OPT3_USED_KEY] = true;
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: FLIP_TAG });

      // 虚拟杀
      await runShensuVirtualSlash(ctx.state, ownerId, target, '神速');

      // 跳过弃牌阶段(直接型):阶段结束(弃牌)+ cancel
      return skipPhase(ctx.state, atom);
    },
    { requireCurrentPlayer: true },
  );

  // ── 翻面:下一回合跳过整回合(共用 face-down 通用版 hook 对) ──
  // 神速族历史上加/去标签均用裸 atom(不补发「翻面后」),emitFaceUpEvent:false 保持事件序列
  registerFlipSkipTurnHooks(state, skill.id, ownerId, '神速', { emitFaceUpEvent: false });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  defineConfirmAction(api, 'respond', { label: '神速', title: '是否发动神速?', style: 'default' });
}
