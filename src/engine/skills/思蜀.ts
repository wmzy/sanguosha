import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { hasBlockingPending, registerAction, registerAfterHook } from '../core/skill';

const REVERSE_TAG = '思蜀/反转';
const CONFIRM_RT = '思蜀/发动';
const TARGET_RT = '思蜀/选目标';
const CONFIRMED_KEY = '思蜀/confirmed';
const TARGET_KEY = '思蜀/target';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '思蜀',
    description: '出牌阶段开始时，你可以指定一名角色，令其本局游戏中乐不思蜀判定效果反转',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const unloadRespond = registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st, params) => {
      const slot = st.pendingSlots.get(ownerId);
      const atom = slot?.atom as { type?: string; requestType?: string } | undefined;
      if (atom?.type !== '请求回应') return '当前不是思蜀询问';
      if (atom.requestType === CONFIRM_RT) return null;
      if (atom.requestType === TARGET_RT) {
        const target = (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
        if (typeof target !== 'number' || !st.players[target]?.alive) return '请选择一名存活角色';
        return null;
      }
      return '当前不是思蜀询问';
    },
    async (st, params) => {
      const slot = st.pendingSlots.get(ownerId);
      const requestType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (requestType === CONFIRM_RT) st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      else if (requestType === TARGET_RT) {
        const target = (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
        if (typeof target === 'number') st.localVars[TARGET_KEY] = target;
      }
    },
  );

  const unloadPhaseStart = registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始' || atom.player !== ownerId || atom.phase !== '出牌') return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive || ctx.state.currentPlayerIndex !== ownerId || hasBlockingPending(ctx.state)) return;
    const candidates = ctx.state.players.filter((player) => player.alive).map((player) => player.index);
    if (candidates.length === 0) return;

    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应', requestType: CONFIRM_RT, target: ownerId,
      prompt: {
        type: 'confirm', title: '是否发动思蜀，令一名角色的乐不思蜀判定效果反转？',
        confirmLabel: '发动', cancelLabel: '不发动',
      },
      defaultChoice: false, timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    delete ctx.state.localVars[TARGET_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应', requestType: TARGET_RT, target: ownerId,
      prompt: {
        type: 'choosePlayer', title: '思蜀：选择一名角色令其乐不思蜀判定效果反转',
        min: 1, max: 1, candidates,
      },
      defaultChoice: candidates[0] as unknown as Json, timeout: 15,
    });
    const target = ctx.state.localVars[TARGET_KEY] as number | undefined;
    delete ctx.state.localVars[TARGET_KEY];
    delete ctx.state.localVars[CONFIRMED_KEY];
    if (typeof target !== 'number' || !candidates.includes(target) || !ctx.state.players[target]?.alive) return;
    await applyAtom(ctx.state, { type: '加标签', player: target, tag: REVERSE_TAG });
  });

  return () => { unloadRespond(); unloadPhaseStart(); };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '思蜀', style: 'primary',
    prompt: { type: 'confirm', title: '是否发动思蜀？', confirmLabel: '发动', cancelLabel: '不发动' },
  });
}

const module: SkillModule = { createSkill, onInit, onMount };
export default module;
