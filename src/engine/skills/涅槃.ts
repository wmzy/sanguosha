// 涅槃(庞统·限定技):当你处于濒死状态时,你可以弃置所有牌和判定区的牌,
// 重置武将牌,摸三张牌并回复至3点体力。
//
// 分析(步骤1):
//   类型:限定技 | 时机:陷入濒死时(濒死状态)
//   流程(确认发动后,按顺序):
//     1. 弃置所有手牌+装备+判定区牌(判定区需先 移除延时锦囊 清 pendingTricks,
//        弃置.apply 会把所有 cardIds 推入弃牌堆)
//     2. 重置武将牌:若处于连环状态,设横置 chained:false
//     3. 摸3张
//     4. 回复至3点(回复体力 amount = max(0, 3 - currentHealth))
//   限定技标记:player.vars['涅槃/used'](整局一次,不被 回合结束 清理)
//
//   钩子:`陷入濒死` after-hook(target=owner 且 未使用过涅槃)→ 请求回应 → 确认后执行。
//   关键:濒死时 alive 仍 true(击杀 atom 才设 false),故 回复体力 validate 通过;
//        runDyingFlow 在 陷入濒死 after-hook 后进入求桃循环,首项 health>0 即 return,
//        涅槃把 health 拉回 3,循环立即退出,庞统不死亡。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { setChain } from '../face-down';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_RT = '涅槃/confirm';
const CONFIRMED_KEY = '涅槃/confirmed';
const USED_KEY = '涅槃/used';
const TARGET_HEALTH = 3;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '涅槃',
    description: '限定技:濒死时弃置所有牌和判定区牌,重置武将牌,摸三张并回复至3点体力',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:庞统回应是否发动涅槃 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是涅槃确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 陷入濒死 after-hook:涅槃主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '陷入濒死', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    // 限定技:整局一次
    if (ctx.state.players[ownerId]?.vars[USED_KEY]) return;
    // 濒死者须仍是"存活"状态(击杀未发生)。理论上 alive 此刻为 true
    const self = ctx.state.players[ownerId];
    if (!self) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动涅槃?(限定技:弃所有牌,摸3张,回复至3体力)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 标记已使用(限定技)。在读到 confirmed 后立即设,防重入。
    // 用 state.vars(不被 回合结束 清理,因后缀不匹配 /usedThisTurn|/healed|/givenCount)。
    // 涅槃是被动触发(无前端按钮),不需「回合用量」同步 view。
    ctx.state.players[ownerId].vars[USED_KEY] = true;

    // 1. 弃置所有牌(手牌+装备+判定区)
    const player = ctx.state.players[ownerId];
    // 先快照(转移过程中数组会变)
    const handCards = [...player.hand];
    const equipCards = Object.values(player.equipment).filter(
      (id): id is string => typeof id === 'string',
    );
    const judgeTricks = player.pendingTricks.map((t) => ({
      trickName: t.name,
      cardId: t.card.id,
    }));
    // 判定区:先移除延时锦囊(清 pendingTricks,前后端同步)
    for (const { trickName } of judgeTricks) {
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName });
    }
    // 统一弃置:弃置.apply 过滤手牌+装备并 push 全部 cardIds 到弃牌堆
    // (判定区牌已不在 hand/equip,filter 为 no-op,但仍被 push 入弃牌堆)
    const allCardIds = [...handCards, ...equipCards, ...judgeTricks.map((t) => t.cardId)];
    if (allCardIds.length > 0) {
      await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: allCardIds });
    }

    // 2. 重置武将牌:解除连环状态
    const chained = ctx.state.players[ownerId].marks.some((m) => m.id === 'chained');
    if (chained) {
      await setChain(ctx.state, ownerId, false);
    }

    // 3. 摸三张牌
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 3 });

    // 4. 回复至3点体力(计算差值;濒死时 health≤0,amount = 3 - health)
    const cur = ctx.state.players[ownerId].health;
    const amount = Math.max(0, TARGET_HEALTH - cur);
    if (amount > 0) {
      await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '涅槃',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动涅槃?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
