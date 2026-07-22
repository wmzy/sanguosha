// 闭月(貂蝉·群·被动技):回合结束阶段,你可以摸一张牌。
//
// 流程(被动触发):
//   1. after-hook 挂「阶段开始」(phase='回合结束'):自己回合结束时触发
//   2. 询问是否发动(请求回应 confirm)
//   3. 确认 → 摸一张牌(摸牌 atom)
//
// 关键点:
//   - 触发时机:阶段开始(回合结束)——回合结束阶段开始时触发。
//     该 atom 由 回合管理 的 阶段结束(弃牌) after-hook 链触发
//     (nextPhase('弃牌')='回合结束' → applyAtom(阶段开始, 回合结束))。
//   - 每回合限一次:回合结束阶段天然一次,无需额外标记。
//   - 可选发动:描述明确"你可以摸一张牌",需询问玩家(confirm)。
//   - respond action 注册在貂蝉本人座次(ownerId),因询问目标是自己。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const CONFIRM_REQUEST = '闭月/confirm';
const CONFIRMED_KEY = '闭月/confirmed';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '闭月',
    description: '回合结束阶段,你可以摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── confirm respond:貂蝉本人回应是否发动闭月 ──
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
      if (atom['requestType'] !== CONFIRM_REQUEST) return '当前不是闭月确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 回合结束阶段开始 → 询问是否摸牌 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.phase !== '回合结束') return;
      if (atom.player !== ownerId) return;

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 询问是否发动闭月
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动闭月?(摸一张牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });

      if (ctx.state.localVars[CONFIRMED_KEY]) {
        await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '闭月',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动闭月?(摸一张牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
