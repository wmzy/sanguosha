// 界绝策(界李儒·群·被动技,OL 界限突破官方逐字):
//   "结束阶段,你可以对一名手牌数小于等于你的其他角色造成一点伤害。"
//
// 界限突破(相对标绝策 —— 标版未实现):
//   1. 标绝策:结束阶段,对"没有手牌"的其他角色造 1 伤。
//   2. 界绝策:结束阶段,对"手牌数 ≤ 自己"的其他角色造 1 伤(放宽条件,更强)。
//
// 流程(被动触发):
//   1. after-hook 挂「阶段开始」(phase='回合结束'):李儒的结束阶段开始时触发。
//   2. 条件:李儒存活 + 有手牌数 ≤ 李儒的其他存活角色 → 询问李儒是否发动(confirm)。
//   3. 确认 → 询问李儒选一名合法目标(choosePlayer,filter:其他存活角色且手牌数 ≤ 李儒)。
//   4. applyAtom(造成伤害, target, amount=1, source=李儒)。
//
// 关键点:
//   - 触发时机:阶段开始(回合结束) —— 与闭月/武烈/勤学等结束阶段技能同构。
//   - 每回合限一次:结束阶段天然一次,无需额外标记。
//   - 手牌数比较:用 state.players[x].hand.length;李儒手牌数 0 时,目标必须为 0(等同标版)。
//   - 目标合法:其他存活角色 + tp.hand.length ≤ self.hand.length。
//   - 可选发动:描述明确"你可以",需询问李儒。
//   - respond action 注册在李儒本人座次(confirm + choosePlayer 两类询问)。
//
// 命名:文件名/loader key/character skill name 均为 '界绝策';内部 Skill.name = '绝策'。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界绝策';
const DISPLAY_NAME = '绝策';

const CONFIRM_RT = '界绝策/confirm';
const CONFIRMED_KEY = '界绝策/confirmed';
const CHOOSE_RT = '界绝策/choose';
const CHOSEN_KEY = '界绝策/target';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '结束阶段:对一名手牌数小于等于你的其他角色造成1点伤害',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:李儒本人回应 confirm / 选目标 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt === CONFIRM_RT) return null; // confirm:任意 params 均接受
      if (rt === CHOOSE_RT) {
        const targets = params.targets as number[] | undefined;
        if (!Array.isArray(targets) || targets.length !== 1) return '请选择一名目标';
        const t = targets[0];
        if (t === ownerId) return '不能以自己为目标';
        if (!st.players[t]?.alive) return '目标不合法';
        const self = st.players[ownerId];
        const tp = st.players[t];
        if (!self || !tp) return '目标不合法';
        if (tp.hand.length > self.hand.length) return '目标手牌数须小于等于你';
        return null;
      }
      return '当前不是绝策询问';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === CHOOSE_RT) {
        const targets = params.targets as number[] | undefined;
        if (Array.isArray(targets) && targets.length === 1) st.localVars[CHOSEN_KEY] = targets[0];
      }
    },
  );

  // ── 结束阶段开始 → 询问李儒是否发动 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomAfterContext): Promise<void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.phase !== '回合结束') return;
      if (atom.player !== ownerId) return;

      const st = ctx.state;
      const self = st.players[ownerId];
      if (!self?.alive) return;

      // 至少一名合法目标(其他存活角色且手牌数 ≤ 自己)
      const myHand = self.hand.length;
      const hasLegalTarget = st.players.some(
        (p) => p.alive && p.index !== ownerId && p.hand.length <= myHand,
      );
      if (!hasLegalTarget) return;

      // 1) 询问是否发动绝策
      delete st.localVars[CONFIRMED_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动绝策?(对一名手牌数≤你的其他角色造成1点伤害)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!st.localVars[CONFIRMED_KEY]) {
        delete st.localVars[CONFIRMED_KEY];
        return;
      }
      delete st.localVars[CONFIRMED_KEY];

      // 2) 询问选目标(合法:其他存活角色且手牌数 ≤ 自己)
      delete st.localVars[CHOSEN_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '绝策:选择一名手牌数≤你的其他角色',
          min: 1,
          max: 1,
          filter: (_view, t) =>
            t !== ownerId &&
            st.players[t]?.alive === true &&
            (st.players[t]?.hand.length ?? 0) <= myHand,
        },
        timeout: 20,
      });
      const chosen = st.localVars[CHOSEN_KEY] as number | undefined;
      delete st.localVars[CHOSEN_KEY];
      if (typeof chosen !== 'number') return; // 超时 → 放弃
      if (!st.players[chosen]?.alive) return;

      // 3) 造成 1 点伤害(来源为李儒)
      await applyAtom(st, { type: '造成伤害', target: chosen, amount: 1, source: ownerId });
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动触发(结束阶段 after-hook),无主动 action 按钮;无前端 prompt 注册。
  // respond 询问由 engine 通用 confirm/choosePlayer UI 渲染(prompt 随请求回应 atom 下发)。
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
