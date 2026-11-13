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
import { registerAction, registerBeforeHook } from '../core/skill';
import { runVirtualSlash, requireRequestType, askConfirm } from '../util/skillRuntime';
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
const SKIP_FLAG = '神速/skipAll'; // 翻面生效时跳过整回合的标志(localVars)
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
  registerBeforeHook(
    state,
    skillId,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== phase) return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(tag)) return;
      // 标签型跳过:去标签 + 阶段结束(当前阶段) + cancel
      return skipPhase(ctx.state, atom, tag);
    },
  );
}

/** 注册「翻面:跳过整个下一回合」的一对 before-hook(机制同据守/放逐):
 *  ① 阶段开始:准备阶段命中翻面标签 → 去标签 + 设 skipAll 标志 + cancel;
 *     skipAll 存续期间取消其余所有阶段(防止 phase-end after-hook 推进产生副作用)。
 *  ② 阶段结束(准备):清除标志并亲自执行 end-turn 序列(清过期标记 → 下一玩家 →
 *     回合结束 → 回合结束后),cancel 阶段结束原子以防幻影阶段链。 */
export function registerShensuFlipTurnHooks(
  state: GameState,
  skillId: string,
  ownerId: number,
): void {
  registerBeforeHook(
    state,
    skillId,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      const self = ctx.state.players[ownerId];

      // 入口:准备阶段开始 + 翻面标签 → 启动跳过
      if (atom.phase === '准备' && self?.tags.includes(FLIP_TAG)) {
        await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: FLIP_TAG });
        ctx.state.localVars[SKIP_FLAG] = ownerId;
        return { kind: 'cancel' };
      }

      // skipAll 标志存在时,取消所有其他阶段(防止 phase-end after-hook 推进产生副作用)
      if (ctx.state.localVars[SKIP_FLAG] === ownerId) {
        return { kind: 'cancel' };
      }
    },
  );

  registerBeforeHook(
    state,
    skillId,
    ownerId,
    '阶段结束',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段结束') return;
      if (atom.player !== ownerId) return;
      if (ctx.state.localVars[SKIP_FLAG] !== ownerId) return;

      // 清除 skipAll 标志(后续不再 skip)
      delete ctx.state.localVars[SKIP_FLAG];

      // 亲自执行 end-turn 序列:清过期标记 → 下一玩家 → 回合结束 → 回合结束后
      // (回合推进 beginTurn 挂在 回合结束后 的 after-hook,故须发出否则下一家不启动)
      await applyAtom(ctx.state, { type: '清过期标记', player: ownerId });
      await applyAtom(ctx.state, { type: '下一玩家' });
      const turnEnded = await applyAtom(ctx.state, { type: '回合结束', player: ownerId });
      if (turnEnded) {
        await applyAtom(ctx.state, { type: '回合结束后', player: ownerId });
      }

      return { kind: 'cancel' };
    },
  );
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
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? (params.target) : undefined);
        if (typeof t === 'number') s.localVars['神速/target'] = t;
      } else if (rt === OPT2_EQUIP_RT) {
        // 兼容 distribute/select 的 cardIds 数组与单 cardId
        const cardIds = params.cardIds as string[] | undefined;
        const single = params.cardId as string | undefined;
        s.localVars['神速/equipCardId'] =
          (Array.isArray(cardIds) && cardIds.length > 0 ? { cardIds: [cardIds[0]] } : null) ??
          (typeof single === 'string' ? single : null);
      }
    },
  );

  // ── 选项1:阶段开始(判定) before-hook ──────────────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const entry = shensuPhaseEntry(ctx, ownerId, '判定', OPT1_USED_KEY);
      if (!entry) return;
      const { atom, self } = entry;

      // 询问是否发动选项1
      if (
        !(await askConfirm(ctx.state, OPT1_TRIGGER_RT, ownerId, {
          confirmedKey: '神速/confirmed',
          title: '是否发动神速①?(跳过判定+摸牌,视为出杀)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
          defaultChoice: false,
          timeout: 10,
        }))
      ) {
        return; // 不发动 → 判定阶段正常进行
      }

      // 选目标
      delete ctx.state.localVars['神速/target'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT1_TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '神速①:选择一名其他角色(视为出杀,无距离限制)',
          min: 1,
          max: 1,
          filter: (_view: GameView, t: number) =>
            t !== ownerId && ctx.state.players[t]?.alive === true,
        },
        timeout: 15,
      });
      const target = ctx.state.localVars['神速/target'] as number | undefined;
      delete ctx.state.localVars['神速/target'];

      // 标记选项1已使用 + 加跳过摸牌标签
      self.vars[OPT1_USED_KEY] = true;
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_MO_TAG });

      // 虚拟杀
      if (typeof target === 'number' && ctx.state.players[target]?.alive) {
        await runVirtualSlash(ctx.state, ownerId, target, { prefix: '神速', charge: true });
      }

      // 跳过判定阶段(直接型):阶段结束(判定)+ cancel
      return skipPhase(ctx.state, atom);
    },
  );

  // ── 选项2:阶段开始(出牌) before-hook ──────────────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const entry = shensuPhaseEntry(ctx, ownerId, '出牌', OPT2_USED_KEY);
      if (!entry) return;
      const { atom, self } = entry;

      // 发动条件:有装备牌(其他存活角色守卫在 shensuPhaseEntry 内)
      const equipCount = Object.values(self.equipment).filter(Boolean).length;
      if (equipCount === 0) return;

      // 询问是否发动选项2
      if (
        !(await askConfirm(ctx.state, OPT2_TRIGGER_RT, ownerId, {
          confirmedKey: '神速/confirmed',
          title: '是否发动神速②?(弃置一张装备牌,跳过出牌,视为出杀)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
          defaultChoice: false,
          timeout: 10,
        }))
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
      const equipCardIdRaw = ctx.state.localVars['神速/equipCardId'] as
        | { cardIds: string[] }
        | string
        | undefined;
      const equipCardId =
        (equipCardIdRaw && typeof equipCardIdRaw === 'object'
          ? equipCardIdRaw.cardIds?.[0]
          : (equipCardIdRaw)) ?? undefined;
      delete ctx.state.localVars['神速/equipCardId'];
      if (!equipCardId || !Object.values(self.equipment).includes(equipCardId)) {
        return; // 无效选择 → 出牌阶段正常进行
      }

      // 选目标
      delete ctx.state.localVars['神速/target'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT2_TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '神速②:选择一名其他角色(视为出杀,无距离限制)',
          min: 1,
          max: 1,
          filter: (_view: GameView, t: number) =>
            t !== ownerId && ctx.state.players[t]?.alive === true,
        },
        timeout: 15,
      });
      const target = ctx.state.localVars['神速/target'] as number | undefined;
      delete ctx.state.localVars['神速/target'];

      // 标记选项2已使用(出牌阶段由下方 skipPhase 直接跳过,无需再加标签;
      // 否则标签残留到下回合会被「跳过出牌」hook 误消费,导致下回合出牌阶段被错误跳过)
      self.vars[OPT2_USED_KEY] = true;

      // 弃置装备牌
      await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [equipCardId], voluntary: true });

      // 虚拟杀
      if (typeof target === 'number' && ctx.state.players[target]?.alive) {
        await runVirtualSlash(ctx.state, ownerId, target, { prefix: '神速', charge: true });
      }

      // 跳过出牌阶段(直接型):阶段结束(出牌)+ cancel
      return skipPhase(ctx.state, atom);
    },
  );

  // ── 跳过摸牌阶段:有标签 → skip(同兵粮寸断) ──────────────────
  registerShensuTagSkipHook(state, skill.id, ownerId, '摸牌', SKIP_MO_TAG);

  // ── 跳过出牌阶段:有标签 → skip(同乐不思蜀) ──────────────────
  registerShensuTagSkipHook(state, skill.id, ownerId, '出牌', SKIP_PLAY_TAG);

  // ── 选项3:阶段开始(弃牌) before-hook ──────────────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const entry = shensuPhaseEntry(ctx, ownerId, '弃牌', OPT3_USED_KEY);
      if (!entry) return;
      const { atom, self } = entry;

      // 询问是否发动选项3
      if (
        !(await askConfirm(ctx.state, OPT3_TRIGGER_RT, ownerId, {
          confirmedKey: '神速/confirmed',
          title: '是否发动神速③?(翻面,跳过弃牌,视为出杀)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
          defaultChoice: false,
          timeout: 10,
        }))
      ) {
        return; // 不发动 → 弃牌阶段正常进行
      }

      // 选目标
      delete ctx.state.localVars['神速/target'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT3_TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '神速③:选择一名其他角色(视为出杀,无距离限制)',
          min: 1,
          max: 1,
          filter: (_view: GameView, t: number) =>
            t !== ownerId && ctx.state.players[t]?.alive === true,
        },
        timeout: 15,
      });
      const target = ctx.state.localVars['神速/target'] as number | undefined;
      delete ctx.state.localVars['神速/target'];

      // 标记选项3已使用 + 加翻面标签(下一回合被消费)
      self.vars[OPT3_USED_KEY] = true;
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: FLIP_TAG });

      // 虚拟杀
      if (typeof target === 'number' && ctx.state.players[target]?.alive) {
        await runVirtualSlash(ctx.state, ownerId, target, { prefix: '神速', charge: true });
      }

      // 跳过弃牌阶段(直接型):阶段结束(弃牌)+ cancel
      return skipPhase(ctx.state, atom);
    },
  );

  // ── 翻面:下一回合跳过整回合(机制同据守/放逐) ────────────────
  registerShensuFlipTurnHooks(state, skill.id, ownerId);

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '神速',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动神速?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
