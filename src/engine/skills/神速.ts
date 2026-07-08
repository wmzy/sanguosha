// src/engine/skills/神速.ts
// 神速(夏侯渊):你可以选择以下一至两项:
//   1. 跳过判定阶段和摸牌阶段;视为对一名其他角色使用一张无距离限制的【杀】。
//   2. 跳过出牌阶段并弃置一张装备牌;视为对一名其他角色使用一张无距离限制的【杀】。
//
// 实现要点:
//   - 选项1 在 阶段开始(判定) before-hook 询问发动;发动则加 跳过摸牌 标签 + 虚拟杀 + cancel 判定。
//   - 选项2 在 阶段开始(出牌) before-hook 询问发动;发动则弃装备 + 虚拟杀 + cancel 出牌。
//   - 虚拟杀:无实体卡,直接走 指定目标→成为目标→检测有效性→询问闪→(被抵消|造成伤害) 流程,
//     与 杀.use 的结算段一致,但不消耗手牌、不计入 杀/quota(规则视为出杀,但本实现简化为
//     不占 quota——神速的杀发生在出牌阶段之前/之中,且与正常出杀统计独立)。
//   - 跳过阶段手法同兵粮寸断/乐不思蜀:applyAtom(阶段结束, 当前阶段) 推进到下一阶段,再 cancel。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  GameView,
  HookResult,
  Skill,
} from '../types';
import { applyAtom, frameCards, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

const OPT1_TRIGGER_RT = '神速/opt1-trigger';
const OPT1_TARGET_RT = '神速/opt1-target';
const OPT2_TRIGGER_RT = '神速/opt2-trigger';
const OPT2_TARGET_RT = '神速/opt2-target';
const OPT2_EQUIP_RT = '神速/opt2-equip';
const SKIP_MO_TAG = '神速/跳过摸牌';
const SKIP_PLAY_TAG = '神速/跳过出牌';
const OPT1_USED_KEY = '神速/opt1Used';
const OPT2_USED_KEY = '神速/opt2Used';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '神速',
    description:
      '可选择一至两项:1.跳过判定+摸牌,视为出杀;2.跳过出牌并弃装备,视为出杀',
  };
}

/** 创建一张虚拟杀卡(无实体,仅用于结算流程的 cardId 引用) */
function makeVirtualKillCard(source: number, target: number, seq: number): string {
  return `神速:杀:${source}:${target}:${seq}`;
}

/**
 * 执行一次"视为出杀"的完整结算(指定目标→成为目标→检测有效性→询问闪→伤害/抵消)。
 * 不消耗手牌、不计入出杀次数;无距离限制。
 */
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = makeVirtualKillCard(source, target, state.seq);
  // 直接写 cardMap:虚拟杀无实体,但结算流程中 atoms/toViewEvents 需要 cardMap[id] 存在
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };

  await pushFrame(state, '神速', source, { virtualKillCardId: cardId });
  try {
    await applyAtom(state, { type: '指定目标', source, target, cardId });
    await applyAtom(state, { type: '成为目标', source, target, cardId });
    const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
    if (!valid) return;
    await applyAtom(state, { type: '询问闪', target, source });
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length > 0) {
      await applyAtom(state, { type: '被抵消', source, target, cardId });
      // drain 闪
      for (const dId of dodgeIds) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else {
      await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId });
    }
  } finally {
    await popFrame(state);
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
    (s) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType ?? '';
      if (
        rt !== OPT1_TRIGGER_RT &&
        rt !== OPT1_TARGET_RT &&
        rt !== OPT2_TRIGGER_RT &&
        rt !== OPT2_TARGET_RT &&
        rt !== OPT2_EQUIP_RT
      ) {
        return '当前不是神速询问';
      }
      return null;
    },
    async (s, params) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType ?? '';
      if (rt === OPT1_TRIGGER_RT || rt === OPT2_TRIGGER_RT) {
        s.localVars['神速/confirmed'] = params.choice === true;
      } else if (rt === OPT1_TARGET_RT || rt === OPT2_TARGET_RT) {
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
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
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

      // 跳过判定阶段:推进到下一阶段 + cancel 当前 阶段开始(判定)
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '判定' });
      return { kind: 'cancel' };
    },
  );

  // ── 选项2:阶段开始(出牌) before-hook ──────────────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
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

      // 跳过出牌阶段:推进到下一阶段 + cancel 当前 阶段开始(出牌)
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '出牌' });
      return { kind: 'cancel' };
    },
  );

  // ── 跳过摸牌阶段:有标签 → skip(同兵粮寸断) ──────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_MO_TAG)) return;

      await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: SKIP_MO_TAG });
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '摸牌' });
      return { kind: 'cancel' };
    },
  );

  // ── 跳过出牌阶段:有标签 → skip(同乐不思蜀) ──────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '出牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_PLAY_TAG)) return;

      await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: SKIP_PLAY_TAG });
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '出牌' });
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
