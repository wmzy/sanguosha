// 志继(姜维·觉醒技):回合开始阶段,若你没有手牌,你须回复1点体力或摸两张牌,
// 然后减1点体力上限,并永久获得技能"观星"。
//
// 分析(步骤1):
//   类型:觉醒技 | 时机:回合开始阶段(「回合开始」atom 的 after-hook)
//   触发条件:ownerId 无手牌 + 未觉醒过(player.vars['志继/awakened'])
//   流程(强制二选一,然后减上限 + 加技能):
//     1. 请求回应(二选一:回复1点体力 / 摸两张牌)— 强制选择
//     2a. 选回复 → 回复体力(target=owner, amount=1,不超过上限;满血跳过)
//     2b. 选摸牌 → 摸牌(player=owner, count=2)
//     3. 设上限(player=owner, amount=maxHealth-1)— 减1点体力上限
//     4. 添加技能(player=owner, skillId='观星')
//   觉醒标记:player.vars['志继/awakened'](后缀不含 usedThisTurn,不被「回合结束」清理)
//
//   钩子:「回合开始」after-hook(atom.player===ownerId)→ 条件满足 → 二选一 → 执行。
//   注意:回合开始阶段对应 '回合开始' atom(player===ownerId),不是 '阶段开始'。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CHOOSE_RT = '志继/choose';
const CHOICE_KEY = '志继/choice';
const AWAKENED_KEY = '志继/awakened';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '志继',
    description: '觉醒技:回合开始且无手牌时,回复1体力或摸2牌,减1体力上限并永久获得"观星"',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:姜维二选一(摸两张牌 / 回复1点体力)──
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
      if (atom['requestType'] !== CHOOSE_RT) return '当前不是志继选择';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      // choice=true → 摸两张牌;choice=false → 回复1点体力
      st.localVars[CHOICE_KEY] = params.choice === true ? 'draw' : 'heal';
    },
  );

  // ── 回合开始 after-hook:志继主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    // 觉醒技:整局一次
    if (ctx.state.players[ownerId]?.vars[AWAKENED_KEY]) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 触发条件:无手牌
    if (self.hand.length > 0) return;

    // 标记已觉醒(在读条件后立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 二选一(强制)
    delete ctx.state.localVars[CHOICE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '志继:摸两张牌,还是回复1点体力?',
        confirmLabel: '摸两张牌',
        cancelLabel: '回复1点体力',
      },
      defaultChoice: false,
      timeout: 30,
    });
    const choice = ctx.state.localVars[CHOICE_KEY] as string | undefined;

    // 2. 执行选择
    if (choice === 'draw') {
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 2 });
    } else {
      // 回复1点(不超过上限;已满血则跳过)
      const cur = ctx.state.players[ownerId].health;
      const max = ctx.state.players[ownerId].maxHealth;
      const amount = Math.min(1, Math.max(0, max - cur));
      if (amount > 0) {
        await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount });
      }
    }

    // 3. 减1点体力上限(设上限 amount = maxHealth - 1,需 > 0)
    const newMax = ctx.state.players[ownerId].maxHealth - 1;
    if (newMax > 0) {
      await applyAtom(ctx.state, { type: '设上限', player: ownerId, amount: newMax });
    }

    // 4. 永久获得"观星"
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '观星' });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '志继',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '志继:摸两张牌,还是回复1点体力?',
      confirmLabel: '摸两张牌',
      cancelLabel: '回复1点体力',
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
