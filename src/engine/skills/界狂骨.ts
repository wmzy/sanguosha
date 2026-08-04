// 界狂骨(界魏延·锁定技):当你对一名角色造成伤害时,若你与其距离不大于 1,
// 你回复 1 点体力或摸一张牌(二选一)。
//
// 实现(被动触发,反馈同构):
//   造成伤害 after hook(source===ownerId, amount>0):
//     若 effectiveDistance(owner, target) <= 1:
//       询问 owner 二选一 —— 回复 1 点体力 / 摸 1 张牌。
//       · choice=true(确认)→ 回复体力 1
//       · choice=false(取消)/ 超时缺省 → 摸牌 1(锁定技必触发,同狂骨已发动分支)
//
// 距离 1 以内:effectiveDistance 最小为 1(座位相邻或自己),<= 1 即满足。
// 装备 -1 马(进攻修正)通过 player.vars['距离/进攻修正'] 进一步缩短距离——自动支持。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';
import { effectiveDistance } from '../distance';

/** 界魏延二选一问询的 requestType(隔离 respond 路由)。
 *  前缀必须等于 skillId('界狂骨'):前端 resolvePendingRespond 按 requestType
 *  前缀推导 skillId 后路由,前缀错(如 '狂骨')会查不到 '界狂骨' 实例 → 点击无效。 */
const CHOOSE_REQUEST = '界狂骨/choose';
/** localVars key:二选一结果 'heal' | 'draw'(respond 写,hook 读) */
const CHOICE_KEY = '界狂骨/choice';

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
      st.localVars[CHOICE_KEY] = params.choice === true ? 'heal' : 'draw';
    },
  );

  // ── 造成伤害 after hook:狂骨主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
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

    // 满血时回复体力无效:禁用「回复体力」按钮(confirmDisabled),玩家只能摸牌。
    const fullHealth = self.health >= self.maxHealth;

    // 界魏延:询问二选一(回复 1 点体力 / 摸 1 张牌)
    delete ctx.state.localVars[CHOICE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '界狂骨:回复1点体力,或摸一张牌?',
        confirmLabel: '回复1点体力',
        cancelLabel: '摸一张牌',
        confirmDisabled: fullHealth ? true : undefined,
      },
      defaultChoice: false,
      timeout: 30,
    });
    const choice = ctx.state.localVars[CHOICE_KEY] as string | undefined;
    if (choice === 'heal') {
      await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
    } else {
      // 'draw' / 超时缺省 → 摸一张牌(锁定技必触发,不可不发动;同狂骨已发动分支)
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    }
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
