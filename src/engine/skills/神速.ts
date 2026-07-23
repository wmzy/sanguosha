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
//   - 虚拟杀:无实体卡,直接走 指定目标→成为目标→检测有效性→询问闪→(被抵消|造成伤害) 流程,
//     与 杀.use 的结算段一致,但不消耗手牌、不计入 杀/quota(规则视为出杀,但本实现简化为
//     不占 quota——神速的杀发生在出牌阶段之前/之中,且与正常出杀统计独立)。
//   - 跳过阶段手法同兵粮寸断/乐不思蜀:applyAtom(阶段结束, 当前阶段) 推进到下一阶段,再 cancel。
//   - 翻面实现(同据守/放逐/界神速):加 '/翻面' 后缀标签,下一回合 阶段开始(准备) before-hook
//     消费标签、设 skipAll 标志并 cancel 阶段;阶段结束(准备) before-hook 亲自推进回合。
import type {
  FrontendAPI,
  GameState,
  GameView,
  HookResult,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';
import { runUseFlow } from '../card-effect/use-card';
import { skipPhase } from '../skip-phase';

const OPT1_TRIGGER_RT = '神速/opt1-trigger';
const OPT1_TARGET_RT = '神速/opt1-target';
const OPT2_TRIGGER_RT = '神速/opt2-trigger';
const OPT2_TARGET_RT = '神速/opt2-target';
const OPT2_EQUIP_RT = '神速/opt2-equip';
const OPT3_TRIGGER_RT = '神速/opt3-trigger';
const OPT3_TARGET_RT = '神速/opt3-target';
const SKIP_MO_TAG = '神速/跳过摸牌';
const SKIP_PLAY_TAG = '神速/跳过出牌';
const FLIP_TAG = '神速/翻面'; // 翻面标签(下一回合被消费,跳过整回合)
const SKIP_FLAG = '神速/skipAll'; // 翻面生效时跳过整回合的标志(localVars)
const OPT1_USED_KEY = '神速/opt1Used';
const OPT2_USED_KEY = '神速/opt2Used';
const OPT3_USED_KEY = '神速/opt3Used';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '神速',
    description:
      '可选择至多三项:①跳过判定+摸牌;②弃装备+跳过出牌;③翻面+跳过弃牌。每项视为出杀',
  };
}

/** 创建一张虚拟杀卡(无实体,仅用于结算流程的 cardId 引用) */
function makeVirtualKillCard(source: number, target: number, seq: number): string {
  return `神速:杀:${source}:${target}:${seq}`;
}

/**
 * 执行一次"视为出杀"的完整结算（runUseFlow virtual 模式）。
 * 不消耗手牌、不计入出杀次数;无距离限制。
 * 走完整时机 atom 序列,保证激昂/集智等技能事件一致。
 */
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = makeVirtualKillCard(source, target, state.seq);
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };
  await runUseFlow(state, source, cardId, [target], '杀', { virtual: true });
  delete state.cardMap[cardId];
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理所有 神速 相关的 trigger/target/equip 询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType ?? '';
      if (
        rt !== OPT1_TRIGGER_RT &&
        rt !== OPT1_TARGET_RT &&
        rt !== OPT2_TRIGGER_RT &&
        rt !== OPT2_TARGET_RT &&
        rt !== OPT2_EQUIP_RT &&
        rt !== OPT3_TRIGGER_RT &&
        rt !== OPT3_TARGET_RT
      ) {
        return '当前不是神速询问';
      }
      return null;
    },
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
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '判定') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (self.vars[OPT1_USED_KEY]) return;

      // 无其他存活角色 → 选项1无意义
      const hasOtherAlive = ctx.state.players.some((p, i) => i !== ownerId && p.alive);
      if (!hasOtherAlive) return;

      // 询问是否发动选项1
      delete ctx.state.localVars['神速/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT1_TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动神速①?(跳过判定+摸牌,视为出杀)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars['神速/confirmed'] !== true) {
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
        await virtualKill(ctx.state, ownerId, target);
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
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '出牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (self.vars[OPT2_USED_KEY]) return;

      // 发动条件:有装备牌 + 有其他存活角色
      const equipCount = Object.values(self.equipment).filter(Boolean).length;
      const hasOtherAlive = ctx.state.players.some((p, i) => i !== ownerId && p.alive);
      if (equipCount === 0 || !hasOtherAlive) return;

      // 询问是否发动选项2
      delete ctx.state.localVars['神速/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT2_TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动神速②?(弃置一张装备牌,跳过出牌,视为出杀)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars['神速/confirmed'] !== true) {
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

      // 标记选项2已使用 + 加跳过出牌标签
      self.vars[OPT2_USED_KEY] = true;
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_PLAY_TAG });

      // 弃置装备牌
      await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [equipCardId] });

      // 虚拟杀
      if (typeof target === 'number' && ctx.state.players[target]?.alive) {
        await virtualKill(ctx.state, ownerId, target);
      }

      // 跳过出牌阶段(直接型):阶段结束(出牌)+ cancel
      return skipPhase(ctx.state, atom);
    },
  );

  // ── 跳过摸牌阶段:有标签 → skip(同兵粮寸断) ──────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_MO_TAG)) return;

      // 标签型跳过:去标签(SKIP_MO_TAG)+ 阶段结束(摸牌)+ cancel
      return skipPhase(ctx.state, atom, SKIP_MO_TAG);
    },
  );

  // ── 跳过出牌阶段:有标签 → skip(同乐不思蜀) ──────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '出牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_PLAY_TAG)) return;

      // 标签型跳过:去标签(SKIP_PLAY_TAG)+ 阶段结束(出牌)+ cancel
      return skipPhase(ctx.state, atom, SKIP_PLAY_TAG);
    },
  );

  // ── 选项3:阶段开始(弃牌) before-hook ──────────────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '弃牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (self.vars[OPT3_USED_KEY]) return;

      // 无其他存活角色 → 选项3无意义
      const hasOtherAlive = ctx.state.players.some((p, i) => i !== ownerId && p.alive);
      if (!hasOtherAlive) return;

      // 询问是否发动选项3
      delete ctx.state.localVars['神速/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT3_TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动神速③?(翻面,跳过弃牌,视为出杀)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars['神速/confirmed'] !== true) {
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
        await virtualKill(ctx.state, ownerId, target);
      }

      // 跳过弃牌阶段(直接型):阶段结束(弃牌)+ cancel
      return skipPhase(ctx.state, atom);
    },
  );

  // ── 翻面:下一回合跳过(机制同据守/放逐/界神速) ────────────────
  // 检测翻面标签 → 移除标签 + 设 skipAll 标志 + cancel(不进入准备阶段)
  registerBeforeHook(
    state,
    skill.id,
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

  // ── 翻面:阶段结束(准备) before-hook,主动推进回合 ────────
  // skipAll 标志存在时:清除标志 + 亲自执行 end-turn 序列把回合交给下家。
  // (与据守/界神速一致:cancel 阶段结束原子以防 phase-end after-hook 推进产生幻影阶段链)
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段结束',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段结束') return;
      if (atom.player !== ownerId) return;
      if (ctx.state.localVars[SKIP_FLAG] !== ownerId) return;

      // 清除 skipAll 标志(后续不再 skip)
      delete ctx.state.localVars[SKIP_FLAG];

      // 亲自执行 end-turn 序列:清过期标记 → 下一玩家 → 回合结束
      await applyAtom(ctx.state, { type: '清过期标记', player: ownerId });
      await applyAtom(ctx.state, { type: '下一玩家' });
      await applyAtom(ctx.state, { type: '回合结束', player: ownerId });

      return { kind: 'cancel' };
    },
  );

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
