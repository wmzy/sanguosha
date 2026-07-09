// 英姿(周瑜·吴·被动技):摸牌阶段，你可以额外摸一张牌。
//
// 机制(镜像裸衣,但 +1 而非 -1):
//   - before hook 挂在「摸牌」:仅在自己摸牌阶段的摸牌(区分无中生有/遗计等)
//     询问是否发动。发动则 modify(count+1)。
//   - 每回合限一次:摸牌阶段天然一次;英姿/usedThisTurn 防重入,
//     后缀 /usedThisTurn 由「回合结束」atom 自动清空。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';
import { registerAction, registerBeforeHook } from '../skill';

const CONFIRM_REQUEST = '英姿/confirm';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '英姿',
    description: '摸牌阶段，你可以额外摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── confirm respond:周瑜本人回应是否发动英姿 ──
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
      if (atom['requestType'] !== CONFIRM_REQUEST) return '当前不是英姿确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars['英姿/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 摸牌 before hook:摸牌阶段询问,发动则额外摸一张 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number; count?: number };
      // 仅自己回合的摸牌阶段(排除无中生有/遗计/苦肉等其他摸牌)
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      if (ctx.state.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (usedThisTurn(ctx.state, ownerId, '英姿')) return; // 本回合已发动

      // 询问是否发动
      delete ctx.state.localVars['英姿/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动英姿?(额外摸一张牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars['英姿/confirmed']) return;

      // 发动:限一次标记(防 dispatch 重入),modify 额外摸一张
      await markOncePerTurn(ctx.state, ownerId, '英姿');
      const count = atom.count ?? 2;
      return { kind: 'modify', atom: { ...ctx.atom, count: count + 1 } as typeof ctx.atom };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '英姿',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动英姿?(额外摸一张牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
