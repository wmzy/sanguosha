// 界魂姿(界孙策·觉醒技,OL hero/452 官方逐字):
//   觉醒技，准备阶段，若你的体力值为1，你减少1点体力上限并获得"英姿""英魂"，
//   本回合结束阶段，你摸两张牌或回复1点体力。
//
// 相对标魂姿(src/engine/skills/魂姿.ts)的差异:
//   1. 触发时机:回合开始 → 准备阶段(「阶段开始」atom,phase='准备' 的 after-hook)
//      (同构于 界志继 vs 志继 的时机变更)
//   2. 觉醒当回合结束阶段新增收益:摸两张牌 或 回复1点体力(二选一,强制选择)
//
// 流程:
//   准备阶段(「阶段开始」phase='准备' after-hook):ownerId 体力为1 + 未觉醒过 →
//     1. 设上限(player=owner, amount=maxHealth-1)— 减1点体力上限(设上限会 clamp 体力,
//        当前1 ≤ 新上限,体力保持1)
//     2. 添加技能(player=owner, skillId='英姿')— 普通版,以文档为准(非界英姿)
//     3. 添加技能(player=owner, skillId='英魂')
//     4. 置 END_BONUS_KEY=true,标记本回合结束阶段需执行收益
//   结束阶段(「阶段开始」phase='回合结束' after-hook):若 END_BONUS_KEY →
//     二选一(强制):摸两张牌 或 回复1点体力;消费标记(一次性)
//
// 关键点:
//   - 觉醒技:整局一次,强制发动(无询问);END_BONUS 仅觉醒当回合触发一次
//   - 体力条件:文档「体力为1」;存活玩家体力≥1,故 health<=1 与 ===1 对存活玩家等价,
//     采用 <=1 同时满足文档与"≤1"两种表述
//   - 觉醒标记键名沿用标版 '魂姿/awakened':界孙策的 界制霸 读取此键判断"觉醒后可拒绝拼点"
//   - END_BONUS_KEY 不用 /usedThisTurn 后缀:结束阶段 hook 在「回合结束」atom 清 vars
//     之前触发并主动清空,语义自洽
//   - 技能实例归属:添加技能 atom 触发 系统规则 after-hook → instantiateSkill,
//     英姿/英魂 以 ownerId=孙策座次 实例化,内部用 skill.ownerId 工作,归属正确
//   - 英姿/英魂 已实现(周瑜·英姿、孙坚·英魂),直接挂载
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

// 觉醒标记:沿用标版键名 '魂姿/awakened',供复用的标 制霸/界制霸 读取觉醒状态。
const AWAKENED_KEY = '魂姿/awakened';
// 觉醒当回合结束阶段收益标记:准备阶段觉醒成功后置 true,结束阶段消费后清空。
// (不放 /usedThisTurn 后缀:结束阶段 hook 在「回合结束」atom 清 vars 之前触发并主动清空。)
const END_BONUS_KEY = '界魂姿/endBonus';
// 结束阶段二选一回应
const CHOOSE_RT = '界魂姿/choose';
const CHOICE_KEY = '界魂姿/choice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界魂姿',
    description:
      '觉醒技:准备阶段且体力为1时,减1体力上限并永久获得"英姿""英魂";本回合结束阶段摸2牌或回复1体力',
  };
}

/** 界魂姿觉醒主逻辑。 */
async function awaken(state: GameState, ownerId: number): Promise<void> {
  // 觉醒技:整局一次
  if (state.players[ownerId]?.vars[AWAKENED_KEY]) return;
  const self = state.players[ownerId];
  if (!self?.alive) return;
  // 体力条件:为1(存活玩家 health<=1 ⟺ ===1)
  if (self.health > 1) return;

  // 标记已觉醒(在读条件后立即设,防重入)
  state.players[ownerId].vars[AWAKENED_KEY] = true;
  // 标记本回合结束阶段需执行收益(由结束阶段 after-hook 消费)
  state.players[ownerId].vars[END_BONUS_KEY] = true;

  // 1. 减1点体力上限(设上限 clamp 体力:当前1 ≤ 新上限,体力保持1)
  await applyAtom(state, {
    type: '设上限',
    player: ownerId,
    amount: self.maxHealth - 1,
  });

  // 2. 永久获得"英姿"(普通版,以文档为准)
  await applyAtom(state, { type: '添加技能', player: ownerId, skillId: '英姿' });

  // 3. 永久获得"英魂"
  await applyAtom(state, { type: '添加技能', player: ownerId, skillId: '英魂' });
}

/** 界魂姿觉醒当回合结束阶段收益:摸两张牌 或 回复1点体力(强制二选一)。 */
async function endPhaseBonus(state: GameState, ownerId: number): Promise<void> {
  const self = state.players[ownerId];
  if (!self?.alive) return;
  if (!self.vars[END_BONUS_KEY]) return;
  // 消费标记(一次性,防重复触发)
  delete state.players[ownerId].vars[END_BONUS_KEY];

  // 二选一(强制):confirm=true → 摸两张牌;false → 回复1点体力
  delete state.localVars[CHOICE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CHOOSE_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '魂姿:摸两张牌,还是回复1点体力?',
      confirmLabel: '摸两张牌',
      cancelLabel: '回复1点体力',
    },
    defaultChoice: false,
    timeout: 30,
  });
  const choice = state.localVars[CHOICE_KEY] as string | undefined;

  if (choice === 'draw') {
    await applyAtom(state, { type: '摸牌', player: ownerId, count: 2 });
  } else {
    // 回复1点(不超过上限;已满血则不回)
    const cur = state.players[ownerId].health;
    const max = state.players[ownerId].maxHealth;
    const amount = Math.min(1, Math.max(0, max - cur));
    if (amount > 0) {
      await applyAtom(state, { type: '回复体力', target: ownerId, amount });
    }
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:界孙策结束阶段二选一(摸两张牌 / 回复1点体力)──
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
      if (atom['requestType'] !== CHOOSE_RT) return '当前不是魂姿选择';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      // choice=true → 摸两张牌;choice=false → 回复1点体力
      st.localVars[CHOICE_KEY] = params.choice === true ? 'draw' : 'heal';
    },
  );

  // ── 准备阶段 after-hook:界魂姿觉醒主逻辑(界孙策在准备阶段触发,而非回合开始)──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase === '准备') {
      await awaken(ctx.state, ownerId);
      return;
    }
    // 结束阶段(engine phase '回合结束'):执行觉醒当回合的结束阶段收益
    if (atom.phase === '回合结束') {
      await endPhaseBonus(ctx.state, ownerId);
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 结束阶段二选一 respond action(觉醒当回合结束阶段触发)
  api.defineAction('respond', {
    label: '界魂姿',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '魂姿:摸两张牌,还是回复1点体力?',
      confirmLabel: '摸两张牌',
      cancelLabel: '回复1点体力',
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
