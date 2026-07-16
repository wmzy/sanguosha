// 界节命(界荀彧·被动技):当你受到1点伤害后,你可以令一名角色将手牌摸至X张
//   (X为其体力上限且最多为5)。若其手牌数原为0,你摸一张牌。
//
// 与标版节命区别:
//   - 标版:目标摸牌至上限,无额外效果。
//   - 界版:若目标手牌数原为0(摸牌前),荀彧(发动者)摸一张牌。
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(target=自己 + amount>0) → 询问发动 → 选目标 → 目标摸牌至上限
//   → 若目标原手牌为0,荀彧摸一张牌
//
// 关键点:
//   - X = min(目标.maxHealth, 5),即体力上限封顶 5
//   - 补牌数 = X - 目标.hand.length,≤0 则不摸(但技能仍算发动)
//   - 目标可选任意存活角色,包括自己
//   - 「原为0」以摸牌前的手牌数为准
//   - 按一次伤害一次触发(与遗计/反馈/放逐一致)
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

// 内部 requestType/localVars 键名保持原前缀「节命/」,不改为「界节命/」
const CONFIRM_RT = '节命/confirm';
const TARGET_RT = '节命/target';
const CONFIRMED_KEY = '节命/confirmed';
const TARGET_KEY = '节命/target';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界节命',
    description: '受到伤害后,令一名角色将手牌摸至其体力上限(最多5张);若其原手牌为0,你摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:荀彧回应界节命的确认 + 目标选择 ──
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
      if (rt !== CONFIRM_RT && rt !== TARGET_RT) return '当前不是节命询问';
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

  // ── 造成伤害 after:荀彧受伤后,选目标 + 摸牌至上限 + 界版额外摸牌 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; amount?: number };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动节命?(令一名角色将手牌摸至体力上限)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 选目标(任意存活角色,含自己)
    delete ctx.state.localVars[TARGET_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '节命:选择一名角色(手牌摸至体力上限)',
        min: 1,
        max: 1,
        filter: (_view: GameView, t: number) =>
          ctx.state.players[t]?.alive === true,
      },
      timeout: 15,
    });
    const target = ctx.state.localVars[TARGET_KEY] as number | undefined;
    delete ctx.state.localVars[TARGET_KEY];
    if (typeof target !== 'number') return;
    if (!ctx.state.players[target]?.alive) return;

    // X = min(目标体力上限, 5)
    const targetPlayer = ctx.state.players[target];
    const x = Math.min(targetPlayer.maxHealth, 5);
    // 记录摸牌前的手牌数(界版:原为0则荀彧摸一张牌)
    const originalHandLength = targetPlayer.hand.length;
    const drawCount = x - originalHandLength;
    if (drawCount > 0) {
      await applyAtom(ctx.state, { type: '摸牌', player: target, count: drawCount });
    }

    // 界版新增:若目标手牌数原为0,荀彧摸一张牌
    if (originalHandLength === 0 && ctx.state.players[ownerId]?.alive) {
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界节命',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动节命?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
