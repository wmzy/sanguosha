// 界放逐(界曹丕·被动技):当你受到伤害后,你可以令一名其他角色翻面并摸X张牌
//   (X为你已损失体力值)。然后若其武将牌已背面朝上,其将武将牌翻回正面。
//   (即翻面后立即翻回,摸牌但不受翻面惩罚。)
//
// 与标版放逐的区别:
//   - 标版:目标摸 X 张并翻面(跳过下一回合)。
//   - 界版:翻面后立即翻回正面,目标只摸牌不受翻面惩罚;且若目标已被其他技能
//     翻面(背面朝上),界放逐会将其翻回正面(解除翻面状态)。
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(target=自己) → 选目标 → 该目标摸 X 张(X=已损失体力) →
//   清除目标所有 '/翻面' 后缀标签(翻回正面)。
//
// 关键点:
//   - X = maxHealth - health(已损失体力值),血越少摸牌越多。
//   - 目标不能是自己(FAQ)。
//   - 界版不添加翻面标签,因此无需阶段跳过 before-hook(与标版放逐的主要区别)。
//   - 清除目标已有的 '/翻面' 标签(来自据守/放逐/悲歌/刚烈等),实现"翻回正面"。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
  GameView,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_RT = '放逐/confirm';
const TARGET_RT = '放逐/target';
const CONFIRMED_KEY = '放逐/confirmed';
const TARGET_KEY = '放逐/target';

/** 武将牌是否已翻面(存在任意 '/翻面' 后缀标签) */
function isFlipped(tags: string[]): boolean {
  return tags.some((t) => t.endsWith('/翻面'));
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界放逐',
    description: '受到伤害后,令一名其他角色摸 X 张牌(X=已损失体力),翻面后立即翻回',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:曹丕回应界放逐的确认 + 目标选择 ──
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
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== TARGET_RT) return '当前不是放逐询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true;
      } else if (rt === TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? (params.target) : undefined);
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
      }
    },
  );

  // ── 造成伤害 after:曹丕受伤后,选目标 + 摸 X 张 + 翻回正面 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; amount?: number };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // X = 已损失体力值
    const lostHealth = self.maxHealth - self.health;
    if (lostHealth <= 0) return; // 满血时 X=0,放逐无意义

    // 必须有其他存活角色可选
    const hasOtherAlive = ctx.state.players.some(
      (p) => p.alive && p.index !== ownerId,
    );
    if (!hasOtherAlive) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动界放逐?(令一名其他角色摸 ${lostHealth} 张牌)`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 选目标(其他存活角色)
    delete ctx.state.localVars[TARGET_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '界放逐:选择一名其他角色(摸牌)',
        min: 1,
        max: 1,
        filter: (_view: GameView, t: number) =>
          t !== ownerId && ctx.state.players[t]?.alive === true,
      },
      timeout: 15,
    });
    const target = ctx.state.localVars[TARGET_KEY] as number | undefined;
    delete ctx.state.localVars[TARGET_KEY];
    if (typeof target !== 'number') return;
    if (!ctx.state.players[target]?.alive) return;

    // 摸 X 张牌
    await applyAtom(ctx.state, { type: '摸牌', player: target, count: lostHealth });

    // 界版:翻面后立即翻回正面 → 清除目标已有的 '/翻面' 标签(若有)
    const targetPlayer = ctx.state.players[target];
    if (targetPlayer && isFlipped(targetPlayer.tags)) {
      const flipTags = targetPlayer.tags.filter((t) => t.endsWith('/翻面'));
      for (const tag of flipTags) {
        await applyAtom(ctx.state, { type: '去标签', player: target, tag });
      }
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界放逐',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动界放逐?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
