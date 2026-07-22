// 狂骨(魏延·被动可选技):当你对距离1以内的一名角色造成1点伤害后,
// 你可以回复1点体力或摸一张牌。
//
// 实现(被动 after-hook + 两步 respond,同反馈/制霸模式):
//   造成伤害 after-hook(source===ownerId, amount>0):
//     若 effectiveDistance(owner, target) <= 1:
//       1. 询问是否发动狂骨(请求回应 requestType='狂骨/confirm',confirm prompt)
//          不发动 / 超时 → 结束(无效果)——「你可以」为可选触发,非锁定自动。
//       2. 发动 → 询问二选一(请求回应 requestType='狂骨/choose',confirm prompt)
//          · choice=true(回复体力)→ 回复体力 1
//          · choice=false(摸牌)/ 超时缺省 → 摸牌 1(已承诺发动,不浪费机会)
//
// 关键点:
//   - 一个技能实例仅能注册一个 respond action(actionKey 冲突),故 confirm 与二选一
//     合并为单 respond 按 requestType 分支(同反馈/固政/制霸模式)。
//   - 距离1以内:effectiveDistance 最小为 1(座位相邻或自己),<= 1 即满足。
//     装备 -1 马(进攻修正)通过 player.vars['距离/进攻修正'] 进一步缩短距离——自动支持。
//   - 官方无体力条件:即使满血也可选择摸牌(回复体力则被上限截断,无溢出)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';
import { effectiveDistance } from '../distance';

/** 是否发动狂骨的 requestType */
const CONFIRM_REQUEST = '狂骨/confirm';
/** 二选一(回复体力 / 摸牌)的 requestType */
const CHOOSE_REQUEST = '狂骨/choose';
/** localVars key:是否发动(respond 写,hook 读) */
const CONFIRMED_KEY = '狂骨/confirmed';
/** localVars key:二选一结果 'heal' | 'draw'(respond 写,hook 读) */
const CHOICE_KEY = '狂骨/choice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '狂骨',
    description: '对距离1以内的角色造成1点伤害后,你可以回复1点体力或摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理「是否发动」与「二选一」两类询问(单 respond 按 requestType 分支)──
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
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_REQUEST && rt !== CHOOSE_REQUEST) return '当前不是狂骨询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_REQUEST) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === CHOOSE_REQUEST) {
        // choice=true(确认)→ 回复体力;choice=false(取消)/缺省 → 摸牌
        st.localVars[CHOICE_KEY] = params.choice === true ? 'heal' : 'draw';
      }
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

    // 距离1以内(含自己):effectiveDistance 最小为 1
    if (effectiveDistance(ctx.state, ownerId, target) > 1) return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 1. 询问是否发动狂骨(可选触发:官方「你可以」)
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动狂骨?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 30,
    });
    if (ctx.state.localVars[CONFIRMED_KEY] !== true) return; // 不发动 → 无效果

    // 2. 发动 → 询问二选一(回复 1 点体力 / 摸 1 张牌)
    delete ctx.state.localVars[CHOICE_KEY];
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
    const choice = ctx.state.localVars[CHOICE_KEY] as string | undefined;
    if (choice === 'heal') {
      await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
    } else {
      // 'draw' 或超时缺省 → 摸一张牌(已承诺发动,不浪费机会)
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    }
  });

  return () => {
    offRespond();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 被动技,无主动 action
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
