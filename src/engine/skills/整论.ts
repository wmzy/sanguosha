// 整论(陆绩·吴·被动技,OL hero/402 风林火山官方逐字):
//   "若你没有'橘',你可以跳过摸牌阶段并获得1枚'橘'。"
//
// 触发时机:阶段开始(摸牌) before-hook(player===ownerId)。
//   条件:owner 当前无橘 → 询问是否发动;发动则获得 1 枚橘 + 跳过摸牌阶段。
//
// 跳过手法(同双雄/再起/巧变):skipPhase 辅助三步——
//   阶段结束(摸牌)→ 回合管理 after-hook 把阶段推进到出牌 → cancel 当前 阶段开始(摸牌)。
//   cancel 后 回合管理 的 phase !== '摸牌' 检查令自动摸 2 张不再执行。
//
// 注意:整论仅在"无橘"时触发。有橘时正常摸牌(由 怀橘 的 before-hook 多摸一张)。
//   获得的橘在本阶段即时生效——但因摸牌阶段已被跳过,怀橘的 摸牌 before-hook 不会触发
//   (摸牌 atom 根本未发出),无冲突。
import { applyAtom } from '../core/apply';
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, registerBeforeHook } from '../core/skill';
import { skipPhase } from '../rules/skip-phase';
import { addJu, juCount } from './怀橘';
import type { SkillModule } from '../types';

const SKILL_ID = '整论';

const CONFIRM_RT = `${SKILL_ID}/confirm`;
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description: '若你没有橘,你可以跳过摸牌阶段并获得1枚橘',
  };
}

/** 当前 pending 的 requestType(类型安全读取) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as { requestType?: string }).requestType;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond action:处理 confirm 询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT) return '当前不是整论询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 阶段开始(摸牌) before-hook:无橘时可跳过摸牌 + 获得 1 枚橘 ──
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '摸牌') return;
    if (atom.player !== ownerId) return;
    const st = ctx.state;
    const me = st.players[ownerId];
    if (!me?.alive) return;
    if (juCount(st, ownerId) > 0) return; // 有橘 → 不触发

    // 询问是否发动整论
    delete st.localVars[CONFIRM_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '整论:你没有橘标记,是否跳过摸牌阶段并获得 1 枚橘?',
        confirmLabel: '跳过并获橘',
        cancelLabel: '正常摸牌',
      },
      defaultChoice: false,
      timeout: 20,
    });
    if (!st.localVars[CONFIRM_KEY]) {
      delete st.localVars[CONFIRM_KEY];
      return; // 不发动 → 正常摸牌
    }
    delete st.localVars[CONFIRM_KEY];

    // 获得 1 枚橘 + 跳过摸牌阶段
    await addJu(st, ownerId);
    return skipPhase(st, { player: ownerId, phase: '摸牌' });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动技:无主动 use action;询问由 respond action 处理
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
