// 界狂骨(界魏延·锁定技):当你对一名角色造成伤害时,若你与其距离不大于 1,
// 你回复 1 点体力或摸一张牌(二选一)。
//
// 实现(被动触发,反馈同构):
//   造成伤害 after hook(source===ownerId, amount>0):
//     若 effectiveDistance(owner, target) <= 1:
//       询问 owner 二选一 —— 回复 1 点体力 / 摸 1 张牌。
//       · choice=true(确认)→ 回复体力 1
//       · choice=false(取消)→ 摸牌 1
//       · 超时/无回应 → 不触发(与刚烈等二选一技能同构)
//
// 距离 1 以内:effectiveDistance 最小为 1(座位相邻或自己),<= 1 即满足。
// 装备 -1 马(进攻修正)通过 player.vars['距离/进攻修正'] 进一步缩短距离——自动支持。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';
import { effectiveDistance } from '../distance';

/** 界魏延二选一问询的 requestType(隔离 respond 路由) */
const CHOOSE_REQUEST = '狂骨/choose';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界狂骨',
    description: '对距离1以内的角色造成伤害时,回复1点体力或摸一张牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:界魏延二选一(回复体力 / 摸牌)──
  // 选择者是魏延本人(owner),故只注册到 ownerId 座次;以 skillId='狂骨' 隔离路由。
  const offRespond = registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CHOOSE_REQUEST) return '当前不是狂骨选择';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      // choice=true(确认)→ 回复体力;choice=false(取消)/缺省 → 摸牌
      st.localVars['狂骨/choice'] = params.choice === true ? 'heal' : 'draw';
    },
  );

  // ── 造成伤害 after hook:狂骨主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.target === undefined) return;
    const target = atom.target;
    if (!ctx.state.players[target]?.alive) return;

    // 距离 1 以内(含自己):effectiveDistance 最小为 1
    if (effectiveDistance(ctx.state, ownerId, target) > 1) return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 界魏延:询问二选一(回复 1 点体力 / 摸 1 张牌)
    delete ctx.state.localVars['狂骨/choice'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '狂骨:回复1点体力,或摸一张牌?',
        confirmLabel: '回复1点体力',
        cancelLabel: '摸一张牌',
      },
      defaultChoice: false,
      timeout: 30,
    });
    const choice = ctx.state.localVars['狂骨/choice'] as string | undefined;
    if (choice === 'heal') {
      await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
    } else if (choice === 'draw') {
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    }
    // 超时/无回应 → 不触发
  });

  return () => {
    offRespond();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 锁定技,无主动 action
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
