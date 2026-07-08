// 放逐(曹丕·被动技):每当你受到一次伤害后,可以令除你以外的任一角色补 X 张牌
//   (X 为你已损失体力值),然后该角色将其武将牌翻面。
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(target=自己) → 选目标 → 该目标摸 X 张(X=已损失体力) → 翻面。
//
// 翻面实现(同据守的手法,但标签名独立,与据守互不干扰):
//   - 加标签 `放逐/翻面` 到目标(下一回合开始时消费)
//   - before hook 挂「阶段开始」:目标准备阶段开始 + 有翻面标签 → 移除标签 +
//     设 skipAll 标志(localVars)+ cancel(不进入准备阶段)
//   - before hook 挂「阶段开始」:skipAll 标志存在时 cancel 所有其他阶段
//   - before hook 挂「阶段结束」:skipAll 标志 → 主动推进回合(清过期标记 +
//     下一玩家 + 回合结束),避免 phase-end after-hook 推进产生幻影阶段链
//
// 关键点:
//   - X = maxHealth - health(已损失体力值),血越少摸牌越多
//   - 目标不能是自己(FAQ)
//   - 翻面 hook 注册在曹丕座次,但 hook 对所有玩家的阶段 atom 触发,callback 内
//     检查目标 player 是否有翻面标签。曹丕存活期内有效。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
  GameView,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const CONFIRM_RT = '放逐/confirm';
const TARGET_RT = '放逐/target';
const CONFIRMED_KEY = '放逐/confirmed';
const TARGET_KEY = '放逐/target';
const SKIP_TAG = '放逐/翻面';
const SKIP_FLAG = '放逐/skipAll';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '放逐',
    description: '受到伤害后,令一名其他角色摸 X 张牌(X=已损失体力)并翻面',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:曹丕回应放逐的确认 + 目标选择 ──
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

  // ── 造成伤害 after:曹丕受伤后,选目标 + 摸 X 张 + 翻面 ──
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
        title: `是否发动放逐?(令一名其他角色摸 ${lostHealth} 张牌并翻面)`,
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
        title: '放逐:选择一名其他角色(摸牌并翻面)',
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
    // 翻面:加标签(下一回合开始时消费)
    await applyAtom(ctx.state, { type: '加标签', player: target, tag: SKIP_TAG });
  });

  // ── 阶段开始 before hook:检测翻面标签 → 启动跳过 ──
  // 注册在曹丕座次,但对所有玩家的 阶段开始 atom 触发(callback 内按 player 检查)
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      const player = atom.player;
      if (player === undefined) return;
      const p = ctx.state.players[player];
      if (!p) return;

      // 入口:准备阶段开始 + 该玩家有翻面标签 → 启动跳过
      if (atom.phase === '准备' && p.tags.includes(SKIP_TAG)) {
        await applyAtom(ctx.state, { type: '去标签', player, tag: SKIP_TAG });
        ctx.state.localVars[SKIP_FLAG] = player;
        return { kind: 'cancel' };
      }

      // skipAll 标志存在时,取消该玩家所有其他阶段(防 phase-end after-hook 推进)
      if (ctx.state.localVars[SKIP_FLAG] === player) {
        return { kind: 'cancel' };
      }
    },
  );

  // ── 阶段结束 before hook:skipAll → 主动推进回合 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段结束',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段结束') return;
      const player = atom.player;
      if (player === undefined) return;
      if (ctx.state.localVars[SKIP_FLAG] !== player) return;

      // 清除 skipAll 标志
      delete ctx.state.localVars[SKIP_FLAG];

      // 亲自执行 end-turn 序列(与 回合管理.end action 一致,但跳过了被 cancel 的阶段)
      await applyAtom(ctx.state, { type: '清过期标记', player });
      await applyAtom(ctx.state, { type: '下一玩家' });
      await applyAtom(ctx.state, { type: '回合结束', player });

      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '放逐',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动放逐?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
