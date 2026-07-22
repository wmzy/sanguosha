// 崩坏(董卓·锁定技):回合结束阶段,若你的体力不是全场最少的(或同时为最少),
// 你须减1点体力或1点体力上限。
//
// 模式 A(被动触发):after hook 挂在「阶段开始」,phase='回合结束'(结束阶段)。
//   结束阶段开始 → 检查体力是否全场最少(含并列) → 若不是则询问选择 → 执行扣减。
//
// 触发条件解析(对齐官方规则):"不是全场最少(或之一)" = 体力严格大于全场最小值。
//   - 体力 == 全场最小(含并列最少) → 不触发
//   - 体力 > 全场最小 → 触发,须扣减
//
// 选择:减1点体力上限(设上限) 或 减1点体力(失去体力)。
//   体力上限最低降至 1(设上限 atom.validate 要求 amount>0)。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CHOOSE_RT = '崩坏/choose';
const CHOICE_KEY = '崩坏/choice'; // 'maxHealth' | 'health'

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '崩坏',
    description: '锁定技:回合结束阶段,若你的体力不是全场最少的,须减1点体力或1点体力上限',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:董卓回应崩坏选择(确认=减体力上限,取消=减体力) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, _params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CHOOSE_RT) return '当前不是崩坏选择';
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      // choice=true → 减体力上限;choice=false(或超时)→ 减体力
      s.localVars[CHOICE_KEY] = params.choice === true ? 'maxHealth' : 'health';
    },
  );

  // ── 结束阶段开始:检查体力并询问 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '回合结束') return; // 结束阶段 = phase '回合结束'

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 全场存活玩家最小体力
    const alivePlayers = ctx.state.players.filter((p) => p.alive);
    const minHealth = alivePlayers.reduce(
      (min, p) => Math.min(min, p.health),
      Number.POSITIVE_INFINITY,
    );
    // 体力 == 最小(含并列)→ 不触发;体力 > 最小 → 触发
    if (self.health <= minHealth) return;

    // 询问选择
    delete ctx.state.localVars[CHOICE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '崩坏:减1点体力上限,还是减1点体力?',
        confirmLabel: '减体力上限',
        cancelLabel: '减体力',
      },
      defaultChoice: false,
      timeout: 15,
    });

    const choice = ctx.state.localVars[CHOICE_KEY];
    delete ctx.state.localVars[CHOICE_KEY];
    if (choice === 'maxHealth') {
      await applyAtom(ctx.state, {
        type: '设上限',
        player: ownerId,
        amount: Math.max(1, self.maxHealth - 1),
      });
    } else {
      await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '崩坏',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '崩坏:减1点体力上限,还是减1点体力?',
      confirmLabel: '减体力上限',
      cancelLabel: '减体力',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
