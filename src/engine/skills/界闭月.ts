// 界闭月(界貂蝉·群·被动技,OL 界限突破官方逐字):
//   结束阶段,若你没有手牌,你可以摸两张牌,否则你可以摸一张牌。
//
// 界限突破(相对标闭月 src/engine/skills/闭月.ts):
//   1. 标闭月:回合结束阶段,你可以摸一张牌。
//   2. 界闭月:无手牌时摸 2 张,有手牌时摸 1 张——新增"无手牌摸两张"强化效果。
//
// 流程(被动触发):
//   1. after-hook 挂「阶段开始」(phase='回合结束'):自己回合结束时触发
//   2. 检查手牌数:0 张 → 询问摸 2 张;否则 → 询问摸 1 张(prompt 动态)
//   3. 确认 → 摸对应张数(摸牌 atom)
//
// 关键点:
//   - 触发时机:阶段开始(回合结束)——回合结束阶段开始时触发。
//     该 atom 由 回合管理 的 阶段结束(弃牌) after-hook 链触发
//     (nextPhase('弃牌')='回合结束' → applyAtom(阶段开始, 回合结束))。
//   - 每回合限一次:回合结束阶段天然一次,无需额外标记。
//   - 可选发动:描述明确"你可以摸",需询问玩家(confirm)。
//   - 手牌数判定时机:hook 触发瞬间读 self.hand.length(此时为回合结束阶段开始,
//     弃牌阶段已结束,手牌数已稳定)。
//   - respond action 注册在貂蝉本人座次(ownerId),因询问目标是自己。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界闭月';
const CONFIRM_REQUEST = `${SKILL_ID}/confirm`;
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '闭月',
    description: '结束阶段,若你没有手牌,你可以摸两张牌,否则你可以摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── confirm respond:界貂蝉本人回应是否发动闭月 ──
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

  // ── 回合结束阶段开始 → 按手牌数询问摸 1 或 2 张 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomAfterContext) => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.phase !== '回合结束') return;
      if (atom.player !== ownerId) return;

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 手牌数判定:0 张 → 摸 2 张;否则 → 摸 1 张
      const drawCount = self.hand.length === 0 ? 2 : 1;
      const countLabel = drawCount === 2 ? '两张牌' : '一张牌';

      // 询问是否发动闭月
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动闭月?(摸${countLabel})`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });

      if (ctx.state.localVars[CONFIRMED_KEY]) {
        await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: drawCount });
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
      title: '是否发动闭月?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
