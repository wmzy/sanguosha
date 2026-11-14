// 界凿险(界邓艾·觉醒技):准备阶段,若"田"的数量≥3,你须减1点体力上限,
//   然后获得技能"急袭",且本回合结束后进行一个额外回合。
//
// 与标版凿险差异:觉醒时额外设 界凿险/extraTurn 标志,本回合结束时触发额外回合。
//   额外回合机制参考 放权/界放权:before hook 挂「回合结束」→ cancel 正常回合结束 →
//   手动清理 per-turn 状态 → 亲自启动 ownerId 的额外回合(回合管理 阶段推进钩子自动走完)。
//   额外回合结束后,正常 座次顺序 推进(下一玩家 atom 自然从 ownerId 推到正常下家)。
//
// 关键点:
//   - 觉醒技:整局一次(player.vars['凿险/awakened'] 防重入)
//   - 田数量 = marks 中 `屯田/田:` 前缀的 mark 数量
//   - 减上限后若体力>新上限,设上限 atom 自动 clamp
//   - 急袭技能模块需在 skills/index.ts 注册
//   - 额外回合仅触发一次(标志在消费后立即清除)
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { startTurn } from '../flows/turn';
import { registerAfterHook, registerBeforeHook } from '../core/skill';
import { isAwakened, markAwakened, clearPerTurnState } from '../rules/vars-keys';

const AWAKENED_KEY = '凿险/awakened';
const EXTRA_TURN_KEY = '凿险/extraTurn'; // localVars:本回合结束时应启动额外回合
const TIAN_PREFIX = '屯田/田:';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界凿险',
    description:
      '觉醒技:准备阶段田≥3时,减1体力上限、获得"急袭",且本回合结束后进行一个额外回合',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 阶段开始(准备) after hook:检查觉醒条件 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '准备') return;
    if (atom.player !== ownerId) return;

    // 觉醒技:整局一次
    if (isAwakened(ctx.state.players[ownerId]?.vars, AWAKENED_KEY)) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 田数量检查
    const tianCount = self.marks.filter((m) => m.id.startsWith(TIAN_PREFIX)).length;
    if (tianCount < 3) return;

    // 标记已觉醒(在读条件后立即设,防重入)
    markAwakened(ctx.state, ownerId, AWAKENED_KEY);

    // 1. 减1点体力上限(设上限 amount = maxHealth - 1;减至0则角色死亡)
    const newMax = self.maxHealth - 1;
    await applyAtom(ctx.state, { type: '设上限', player: ownerId, amount: newMax });

    // 2. 获得技能"急袭"
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '急袭' });

    // 3. 界版变化:标记本回合结束时应进行额外回合
    ctx.state.localVars[EXTRA_TURN_KEY] = true;
  });

  // ── 回合结束 before:界凿险的额外回合机制 ──
  //   邓艾的回合结束 + EXTRA_TURN_KEY 标志 → cancel 本回合结束(阻止 回合管理 findNextAlive 推进)
  //   → 手动清理 per-turn 状态 → 亲自启动邓艾的额外回合
  //   额外回合的 回合结束 不会再次触发(标志已清除)→ 正常推进座次。
  //   before 先于 回合管理 的 after-hook,cancel 后其 after-hook 不执行。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '回合结束',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '回合结束') return;
      if (atom.player !== ownerId) return;

      const st = ctx.state;
      if (st.localVars[EXTRA_TURN_KEY] !== true) return;
      delete st.localVars[EXTRA_TURN_KEY];

      const self = st.players[ownerId];
      if (!self?.alive) return; // 已死亡 → 不启动额外回合,放行正常回合结束

      // cancel 回合结束 → 手动清理 per-turn 状态(否则 apply 不执行,状态残留)
      clearPerTurnState(st);

      // 亲自启动额外回合(邓艾自己)。
      // 额外回合结束后:下一玩家 atom 自然从 ownerId 推到正常下家(座次顺序不变)。
      st.currentPlayerIndex = ownerId;
      await startTurn(st, ownerId);

      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 觉醒技无主动 action;前端通过 view.marks 展示田数量。
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
