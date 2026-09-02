// 界放逐(界曹丕·被动技):当你受到伤害后,你可以令一名其他角色翻面,
//   并令其摸X张牌(X为你已损失体力值)。(官方逐字,界曹丕.md)
//
// 与标版放逐的区别:仅文案细节;机制同构——目标真实翻面(跳过下一回合),
// 作为交换摸 X 张牌。
//
// 模式 A(被动触发):after hook 挂在「受到伤害后」。
//   受到伤害(target=自己) → 询问发动 → 选目标 → 该目标翻面 → 摸 X 张(X=已损失体力)。
//
// 关键点:
//   - X = maxHealth - health(已损失体力值),血越少摸牌越多。
//   - 目标不能是自己(FAQ)。
//   - 翻面实现(镜像标版 放逐):flipFaceDown 加标签 '放逐/翻面';
//     阶段开始 before-hook 消费标签(skipAll + cancel),阶段结束 before-hook
//     主动推进回合(performSkipTurn)。
//   - 已知简化:对已背面目标再次放逐不实现官方 toggle(翻面两次=翻回正面),
//     与全引擎翻面模型一致(flipFaceDown 只追加标签,回合管理的 flipFaceUpAll
//     一次清全部 /翻面 标签,双翻无法对消)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
  GameView,
} from '../types';
import { getHealthValue } from '../types';
import { applyAtom } from '../core/apply';
import { flipFaceDown, flipFaceUp, performSkipTurn } from '../flows/face-down';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';

const CONFIRM_RT = '界放逐/confirm';
const TARGET_RT = '界放逐/target';
const CONFIRMED_KEY = '放逐/confirmed';
const TARGET_KEY = '放逐/target';
const SKIP_TAG = '放逐/翻面';
const SKIP_FLAG = '放逐/skipAll';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界放逐',
    description: '受到伤害后,令一名其他角色翻面,并摸 X 张牌(X=已损失体力)',
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

  // ── 受到伤害后 after:曹丕受伤后,选目标 → 翻面 → 摸 X 张(官方语序)──
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // X = 已损失体力值
    const lostHealth = self.maxHealth - getHealthValue(self);
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
        title: `是否发动界放逐?(令一名其他角色翻面并摸 ${lostHealth} 张牌)`,
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
        title: '界放逐:选择一名其他角色(翻面并摸牌)',
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

    // 翻面(官方语序:「令一名其他角色翻面,并令其摸X张牌」)
    await flipFaceDown(ctx.state, target, '放逐');

    // 摸 X 张牌
    await applyAtom(ctx.state, { type: '摸牌', player: target, count: lostHealth });
  });

  // ── 阶段开始 before hook:检测翻面标签 → 启动跳过(镜像标版 放逐)──
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx): Promise<HookResult | void> => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    const player = atom.player;
    if (player === undefined) return;
    const p = ctx.state.players[player];
    if (!p) return;

    if (atom.phase === '准备' && p.tags.includes(SKIP_TAG)) {
      await flipFaceUp(ctx.state, player, '放逐');
      ctx.state.localVars[SKIP_FLAG] = player;
      return { kind: 'cancel' };
    }
    if (ctx.state.localVars[SKIP_FLAG] === player) {
      return { kind: 'cancel' };
    }
  });

  // ── 阶段结束 before hook:skipAll → 主动推进回合 ──
  registerBeforeHook(state, skill.id, ownerId, '阶段结束', async (ctx): Promise<HookResult | void> => {
    const atom = ctx.atom;
    if (atom.type !== '阶段结束') return;
    const player = atom.player;
    if (player === undefined) return;
    if (ctx.state.localVars[SKIP_FLAG] !== player) return;

    delete ctx.state.localVars[SKIP_FLAG];
    await performSkipTurn(ctx.state, player);
    return { kind: 'cancel' };
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
