// 界志继(界姜维·觉醒技,OL 界限突破官方逐字):
//   觉醒技,准备阶段或结束阶段,若你没有手牌,你须回复1点体力或摸两张牌,
//   然后减1点体力上限,并永久获得技能"观星"。
//
// 与原版志继差异:触发时机(原版仅准备阶段;界版额外可在结束阶段触发)。
//   原版姜维:准备阶段(「阶段开始」atom,phase='准备' 的 after-hook)
//   界姜维:准备阶段 **或结束阶段**(「阶段开始」atom,phase='准备' 或 '回合结束' 的 after-hook)
//
// 分析(步骤1):
//   类型:觉醒技 | 时机:准备阶段 / 结束阶段(两个时机均可)
//   触发条件:ownerId 无手牌 + 未觉醒过(player.vars['志继/awakened'])
//   流程(强制二选一,然后减上限 + 加技能):
//     1. 请求回应(二选一:回复1点体力 / 摸两张牌)— 强制选择
//     2a. 选回复 → 回复体力(target=owner, amount=1,不超过上限;满血跳过)
//     2b. 选摸牌 → 摸牌(player=owner, count=2)
//     3. 设上限(player=owner, amount=maxHealth-1)— 减1点体力上限
//     4. 添加技能(player=owner, skillId='观星')
//   觉醒标记:player.vars['志继/awakened'](后缀不含 usedThisTurn,不被「回合结束」清理)
//   防重入:AWAKENED_KEY 在 awaken() 入口即设,准备阶段触发后即使结束阶段无手牌也不会再触发。
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
    name: '界志继',
    description: '觉醒技:准备阶段或结束阶段且无手牌时,回复1体力或摸2牌,减1体力上限并永久获得"观星"',
  };
}

/** 界志继觉醒主逻辑。 */
async function awaken(state: GameState, ownerId: number): Promise<void> {
  // 觉醒技:整局一次
  if (state.players[ownerId]?.vars[AWAKENED_KEY]) return;
  const self = state.players[ownerId];
  if (!self?.alive) return;
  // 触发条件:无手牌
  if (self.hand.length > 0) return;

  // 标记已觉醒(在读条件后立即设,防重入)
  state.players[ownerId].vars[AWAKENED_KEY] = true;

  // 1. 二选一(强制)
  delete state.localVars[CHOICE_KEY];
  await applyAtom(state, {
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
  const choice = state.localVars[CHOICE_KEY] as string | undefined;

  // 2. 执行选择
  if (choice === 'draw') {
    await applyAtom(state, { type: '摸牌', player: ownerId, count: 2 });
  } else {
    // 回复1点(不超过上限;已满血则跳过)
    const cur = state.players[ownerId].health;
    const max = state.players[ownerId].maxHealth;
    const amount = Math.min(1, Math.max(0, max - cur));
    if (amount > 0) {
      await applyAtom(state, { type: '回复体力', target: ownerId, amount });
    }
  }

  // 3. 减1点体力上限(设上限 amount = maxHealth - 1,需 > 0)
  const newMax = state.players[ownerId].maxHealth - 1;
  if (newMax > 0) {
    await applyAtom(state, { type: '设上限', player: ownerId, amount: newMax });
  }

  // 4. 永久获得"观星"
  await applyAtom(state, { type: '添加技能', player: ownerId, skillId: '观星' });
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

  // ── 准备阶段 / 结束阶段 after-hook:界志继主逻辑(界姜维在这两个时机均可触发)──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    // 官方:"准备阶段或结束阶段" —— 两个时机均可触发。引擎中"结束阶段"=phase='回合结束'。
    if (atom.phase !== '准备' && atom.phase !== '回合结束') return;
    if (atom.player !== ownerId) return;
    await awaken(ctx.state, ownerId);
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
