// 借刀杀人 CardEffect — 普通锦囊·借刀杀人的使用结算 + 被借刀回应入口。
//
// resolve（单目标 A）：询问无懈可击 → 请求 A 出杀(useCardAndTarget) → 检查 A 的选择。
//   A 出杀 → runUseFlow('杀') 走完整杀结算
//           （询问闪 → 伤害,damageType 自动传导,火杀/雷杀不再丢失属性）。
//   A 不出杀 → 使用者获得 A 的武器。
//
// 双目标特殊处理：targets=[A]（武器持有者），killTarget=B 存入 localVars。
// resolve 通过 localVars[KILL_TARGET_VAR] 读取 B。
// A 的「出杀」选择由本文件的 respond 字段(被 play-card 按卡名注册到每个座次)写入
// localVars[CHOICE_VAR] = { cardId, targets }。

import type { Card, GameState, GameView, Json } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../index';
import { runUseFlow } from '../card-effect/use-card';
import { isCardBanned } from '../card-effect/validate';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';
import { inAttackRange } from '../distance';

/** 请求 A 出杀问询的 requestType */
const REQUEST_TYPE = '借刀杀人/出杀';
/** localVars key:A 的出杀选择(cardId+targets);不设 = 交出武器 */
const CHOICE_VAR = '借刀杀人/出杀选择';
/** localVars key:发起者指定的杀目标 B */
const KILL_TARGET_VAR = '借刀杀人/killTarget';

/** 从 target 处卸下武器并交给 source(借刀杀人“不出杀/交武器”分支) */
async function acquireWeapon(state: GameState, source: number, target: number): Promise<void> {
  const weaponId = state.players[target]?.equipment['武器'];
  if (!weaponId) return;
  await applyAtom(state, { type: '卸下', player: target, slot: '武器' });
  await applyAtom(state, { type: '获得', player: source, cardId: weaponId, from: target });
}

/** 借刀杀人的结算：请求出杀 → 读取选择 → runUseFlow 杀结算/获得武器 */
async function resolveBorrowedSword(ctx: ResolveCtx): Promise<void> {
  const { state, source, target } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理
  const killTarget = state.localVars[KILL_TARGET_VAR] as number;
  const killTargetName = state.players[killTarget]?.name ?? '?';

  // 请求 A 选择：出杀(含 B/方天画戟多目标) 或 交出武器
  await applyAtom(state, {
    type: '请求回应',
    requestType: REQUEST_TYPE,
    target,
    prompt: {
      type: 'useCardAndTarget',
      title: `借刀杀人:对 ${killTargetName} 使用一张杀,或交出武器`,
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      // 方天画戟等允许多目标;距离/必含 B 由后端 canUse + mandatedTargets 校验
      targetFilter: { min: 1, max: 3, filter: () => true },
    },
    timeout: 20,
  });

  const choice = state.localVars[CHOICE_VAR] as
    | { cardId: string; targets: number[] }
    | undefined;
  delete state.localVars[CHOICE_VAR];

  if (choice) {
    // respond.validate 已保证:杀在手、killTarget ∈ targets、全部在攻击范围、A 未被禁出牌。
    // 合法性闸门在 respond,resolve 直接走完整杀结算(询问闪→伤害),不计出杀次数。
    await runUseFlow(state, target, choice.cardId, choice.targets, '杀');
  } else {
    // 未选(pass/超时)= 交出武器
    await acquireWeapon(state, source, target);
  }
}

/** 借刀杀人牌特有校验：目标有武器、killTarget 合法、A 不能是自己
 *  killTarget 允许是发起者自己(借别人的刀杀自己)。 */
function canUseBorrowedSword(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  // 兼容 targets=[A,B] 和 target=A+killTarget=B 两种格式
  let targetIdx: number | undefined;
  let killTargetIdx: number | undefined;
  if (
    Array.isArray(params.targets) &&
    (params.targets as unknown[]).length >= 2 &&
    typeof (params.targets as unknown[])[0] === 'number' &&
    typeof (params.targets as unknown[])[1] === 'number'
  ) {
    const arr = params.targets as number[];
    targetIdx = arr[0];
    killTargetIdx = arr[1];
  } else {
    targetIdx = params.target as number | undefined;
    killTargetIdx = params.killTarget as number | undefined;
  }
  if (typeof targetIdx !== 'number') return 'target required';
  if (typeof killTargetIdx !== 'number') return 'killTarget required';
  const target = state.players[targetIdx];
  if (!target?.alive) return '目标不合法';
  if (!target.equipment['武器']) return '目标没有武器';
  if (targetIdx === ownerId) return '不能对自己使用';
  const killTargetPlayer = state.players[killTargetIdx];
  if (!killTargetPlayer?.alive) return '杀的目标不合法';
  // killTarget 允许是发起者自己(借别人的刀杀自己);仅禁止等于借刀目标 A
  if (killTargetIdx === targetIdx) return '杀的目标不能是借刀杀人目标';
  return null;
}

const borrowedSwordEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'other', min: 1, max: 1 },
  canUse: canUseBorrowedSword,
  resolve: resolveBorrowedSword,
  // 双目标预处理：targets=[A,B] 或 target=A+killTarget=B。
  // 提取 killTarget 存入 localVars，返回 [A] 作为锦囊真实目标传给 runUseFlow。
  preUse: (state, _ownerId, params) => {
    let targetIdx: number;
    let killTargetIdx: number;
    if (
      Array.isArray(params.targets) &&
      (params.targets as unknown[]).length >= 2 &&
      typeof (params.targets as unknown[])[0] === 'number' &&
      typeof (params.targets as unknown[])[1] === 'number'
    ) {
      const arr = params.targets as number[];
      targetIdx = arr[0];
      killTargetIdx = arr[1];
    } else {
      targetIdx = params.target as number;
      killTargetIdx = params.killTarget as number;
    }
    state.localVars[KILL_TARGET_VAR] = killTargetIdx;
    return [targetIdx];
  },
  // respond：被借刀者 A 对「借刀杀人/出杀」问询的回应入口。
  // 由 play-card(使用牌) 按卡名 skillId 注册到每个座次——A 可能是任意玩家，跨座次回应。
  // validate 不传 cardId = 选择交出武器(pass)，由 resolve 兑底走交武器分支。
  // 逻辑原驻 skills/借刀杀人.ts，重构 f7536790 后并入 CardEffect.respond（镜像火攻/顺手牵羊）。
  respond: {
    validate: (state, ownerId, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target?: number }).target !== ownerId) return '不是问你的';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== REQUEST_TYPE) return '当前不是借刀杀人询问';
      // 不传 cardId = 选择交出武器(pass),由 resolve 兑底走交武器分支
      const cardId = params.cardId as string | undefined;
      if (cardId === undefined) return null;
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length === 0) return '请选择杀的目标';
      const self = state.players[ownerId];
      if (!self?.hand.includes(cardId)) return '牌不在手牌中';
      if (state.cardMap[cardId]?.name !== '杀') return '只能使用杀';
      // 被借刀者若被禁出牌(义绝),不得选择出杀 → 只能交出武器
      if (isCardBanned(state, ownerId, '杀')) return '你不能使用杀';
      // 必含发起者指定的 killTarget(权威校验,前端 targetFilter 仅提示)
      const killTarget = state.localVars[KILL_TARGET_VAR] as number | undefined;
      if (killTarget !== undefined && !targets.includes(killTarget))
        return '必须包含借刀杀人指定的目标';
      // 每个目标须在 A 的攻击范围内(镜像 杀.canUse 的距离校验)。
      // 在 respond 阶段即拒绝非法选择,避免进入结算后 useCard 静默白费整张借刀杀人
      for (const t of targets) {
        if (!inAttackRange(state, ownerId, t, cardId)) return '目标不在攻击范围内';
      }
      return null;
    },
    execute: async (state, ownerId, params) => {
      const cardId = params.cardId as string | undefined;
      const targets = params.targets as number[] | undefined;
      // 不传 = 交武器,localVars 不设选择 → resolve 走交武器分支
      if (typeof cardId === 'string' && Array.isArray(targets)) {
        state.localVars[CHOICE_VAR] = { cardId, targets };
      }
    },
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '借刀杀人',
    cardFilter: { filter: (c: Card) => c.name === '借刀杀人', min: 1, max: 1 },
    // 双目标：A=持有武器的其他角色（借刀目标），B=杀的目标（任意其他角色，无视距离）。
    // 后端 canUseBorrowedSword 权威校验；此处 filter 仅为前端 UI 提示（置灰不可选座位）。
    // 缺 slots 会导致前端把借刀杀人当单目标牌：选了 A 即可点出牌，但缺 killTarget
    // 被后端静默拒绝 → 「无法选杀的目标、出牌无响应」。
    targetFilter: {
      min: 2,
      max: 2,
      slots: [
        {
          label: '借刀目标',
          filter: (view: GameView, t: number) =>
            t !== view.currentPlayerIndex &&
            !!view.players[t]?.alive &&
            !!view.players[t]?.equipment['武器'],
        },
        {
          label: '杀的目标',
          filter: (view: GameView, t: number, ctx: { selected: number[] }) =>
            // 借刀杀人可借别人的刀杀自己 → B 允许是发起者;仅排除 A(借刀目标) 与非存活
            !!view.players[t]?.alive && !ctx.selected.includes(t),
        },
      ],
    },
  } as ActionPrompt,
  // respond 入口 UI：选一张杀 + 杀的目标(方天画戟等多目标)；后端 validate 权威校验距离/必含
  respondPrompt: {
    type: 'useCardAndTarget',
    title: '借刀杀人:对指定角色使用一张杀,或交出武器',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    targetFilter: { min: 1, max: 3, filter: () => true },
  } as ActionPrompt,
  label: '借刀杀人',
  style: 'danger',
};

registerCardEffect('借刀杀人', borrowedSwordEffect);
