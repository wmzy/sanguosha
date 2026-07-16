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
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, registerBeforeHook } from '../skill';

const AWAKENED_KEY = '凿险/awakened';
const EXTRA_TURN_KEY = '凿险/extraTurn'; // localVars:本回合结束时应启动额外回合
const TIAN_PREFIX = '屯田/田:';

/** 复刻「回合结束」atom 的 per-turn 清理(cancel 回合结束后 atom.apply 不执行,需手动清理)。
 *  与 回合结束.ts apply 保持一致:清空 turn.vars、清所有玩家 duration='turn' 标记、
 *  清 /usedThisTurn|/healed|/givenCount|/givenTargets vars。 */
function clearPerTurnState(state: GameState): void {
  state.turn.vars = {};
  for (const p of state.players) {
    p.marks = p.marks.filter((m) => m.duration !== 'turn');
    p.vars = Object.fromEntries(
      Object.entries(p.vars).filter(
        ([k]) =>
          !k.endsWith('/usedThisTurn') &&
          !k.endsWith('/healed') &&
          !k.endsWith('/givenCount') &&
          !k.endsWith('/givenTargets'),
      ),
    );
  }
}

/** 亲自启动 player 的一个完整回合:回合开始 → 准备阶段开始 → 准备阶段结束。
 *  回合管理的阶段推进 after-hook 据此自动走完该玩家的判定/摸牌/出牌/弃牌/回合结束。 */
async function startTurn(state: GameState, player: number): Promise<void> {
  await applyAtom(state, { type: '回合开始', player });
  await applyAtom(state, { type: '阶段开始', player, phase: '准备' });
  await applyAtom(state, { type: '阶段结束', player, phase: '准备' });
}

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
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '准备') return;
    if (atom.player !== ownerId) return;

    // 觉醒技:整局一次
    if (ctx.state.players[ownerId]?.vars[AWAKENED_KEY]) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 田数量检查
    const tianCount = self.marks.filter((m) => m.id.startsWith(TIAN_PREFIX)).length;
    if (tianCount < 3) return;

    // 标记已觉醒(在读条件后立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 减1点体力上限(设上限 amount = maxHealth - 1,需 > 0)
    const newMax = self.maxHealth - 1;
    if (newMax > 0) {
      await applyAtom(ctx.state, { type: '设上限', player: ownerId, amount: newMax });
    }

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
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number };
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
