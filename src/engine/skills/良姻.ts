// 良姻(周妃·吴·被动技):当每回合首次有牌移出/移入游戏后,你可以与一名其他角色
//   各摸/弃置一张牌,然后你可以令其中一名手牌数为X的角色回复1点体力
//   (X为"箜声"牌数,即 owner.vars['箜声/牌'] 的张数)。
//
// 模式 A(被动触发):after-hook 挂在「移出至暂存区」(移出游戏)与「归还暂存牌」(移入游戏)上。
//   触发流程:设本回合已触发标记 → 询问发动 → 选目标 → 选摸/弃 → 执行摸弃 → 选回血目标。
//
// 触发时机("牌移出/移入游戏"):
//   - 移出至暂存区:破军/谦逊/箜声置牌等把牌移出标准区域 → 移出游戏。
//   - 归还暂存牌:暂存牌归还手牌 → 移入游戏。
//   两者均为引擎通用的"移出/移入"机制。箜声准备阶段置牌走 移出至暂存区 → 触发良姻;
//   箜声结束阶段归还走 归还暂存牌,但良姻本回合已触发(准备阶段),不再触发。
//
// 关键点:
//   - "每回合首次":turn.vars[`良姻/已触发/${ownerId}`],由「回合结束」atom 自动清空。
//     标记在检测到首次移出/移入时立即写入(无论是否发动),消耗本回合唯一一次触发。
//   - X = 箜声牌数 = owner.vars['箜声/牌']?.length ?? 0(与 箜声.ts 共享 key)。
//   - 摸/弃由周妃选模式,双方执行同一动作:摸=各摸1;弃=各弃1(各自选弃牌)。
//   - 回血目标限于"其中"(周妃与所选目标)且手牌数==X 且未满血者。
//   - requestType 前缀必须等于技能 id('良姻');respond 注册到全部座次(弃牌询问可能落到目标座次)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { getHealthValue } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

/** owner.vars key:箜声牌 cardId 列表(由 箜声.ts 维护,良姻只读) */
const KONGSHENG_KEY = '箜声/牌';

const CONFIRM_RT = '良姻/confirm'; // 是否发动
const TARGET_RT = '良姻/目标'; // 选一名其他角色
const MODE_RT = '良姻/摸弃'; // 选摸/弃
const DISCARD_RT = '良姻/弃牌'; // 弃牌(自己/目标共用,按座次区分)
const HEAL_RT = '良姻/回血'; // 选回血目标

const CONFIRMED_KEY = '良姻/confirmed';
const TARGET_KEY = '良姻/目标';
const MODE_KEY = '良姻/摸弃'; // '摸' | '弃'
const DISCARD_KEY = '良姻/弃牌结果';
const HEAL_KEY = '良姻/回血目标';

/** 本回合是否已触发良姻(turn.vars,回合结束自动清空) */
function triggeredKey(ownerId: number): string {
  return `良姻/已触发/${ownerId}`;
}

/** 当前箜声牌数(X) */
function kongshengCount(state: GameState, player: number): number {
  return (
    (state.players[player].vars[KONGSHENG_KEY] as string[] | undefined)
      ?.length ?? 0
  );
}

/** 从 respond params 提取选中的目标座次(targets 数组优先,兼容 target 单值) */
function extractTarget(params: Record<string, Json>): number | undefined {
  const arr = params.targets as number[] | undefined;
  if (Array.isArray(arr) && arr.length > 0) return arr[0];
  const t = params.target;
  return typeof t === 'number' ? t : undefined;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '良姻',
    description:
      '每回合首次有牌移出/移入游戏后,你可以与一名其他角色各摸/弃置一张牌,然后可令其中一名手牌数为X的角色回复1点体力(X为箜声牌数)',
  };
}

/** 良姻触发主逻辑:询问发动 → 选目标 → 选摸弃 → 执行 → 选回血。 */
async function performLiangyin(
  state: GameState,
  ownerId: number,
): Promise<void> {
  const self = state.players[ownerId];
  if (!self?.alive) return;

  // X = 箜声牌数(此刻箜声牌已在武将牌上,准备阶段置牌后触发)
  const x = kongshengCount(state, ownerId);

  // 1) 是否发动
  delete state.localVars[CONFIRMED_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: `是否发动良姻?(与一名其他角色各摸/弃一张牌,X=${x})`,
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 15,
  });
  if (!state.localVars[CONFIRMED_KEY]) {
    delete state.localVars[CONFIRMED_KEY];
    return;
  }
  delete state.localVars[CONFIRMED_KEY];

  // 2) 选一名其他角色
  delete state.localVars[TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '良姻:选择一名其他角色',
      min: 1,
      max: 1,
      filter: (_view, t) =>
        t !== ownerId && state.players[t]?.alive === true,
    },
    timeout: 15,
  });
  const target = state.localVars[TARGET_KEY] as number | undefined;
  delete state.localVars[TARGET_KEY];
  if (typeof target !== 'number' || !state.players[target]?.alive) return;

  // 3) 选摸/弃(confirm:确认=各摸一张,取消=各弃一张)
  delete state.localVars[MODE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: MODE_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '良姻:各摸一张牌 还是 各弃一张牌?',
      confirmLabel: '各摸一张',
      cancelLabel: '各弃一张',
    },
    defaultChoice: true,
    timeout: 15,
  });
  const mode =
    (state.localVars[MODE_KEY] as '摸' | '弃' | undefined) ?? '摸';
  delete state.localVars[MODE_KEY];

  // 4) 执行摸/弃
  if (mode === '摸') {
    await applyAtom(state, { type: '摸牌', player: ownerId, count: 1 });
    if (state.players[target]?.alive) {
      await applyAtom(state, { type: '摸牌', player: target, count: 1 });
    }
  } else {
    // 各弃一张:有手牌者各自选弃一张(强制型,超时自动弃首张)
    await discardOne(state, ownerId);
    if (state.players[target]?.alive) {
      await discardOne(state, target);
    }
  }

  // 5) 回血:在 {周妃, 目标} 中手牌数==X 且未满血者里选一名回复
  if (!state.players[ownerId]?.alive) return;
  const candidates = [ownerId, target].filter((p) => {
    const pl = state.players[p];
    if (!pl?.alive) return false;
    if (pl.hand.length !== x) return false;
    return getHealthValue(pl) < pl.maxHealth;
  });
  if (candidates.length === 0) return;

  delete state.localVars[HEAL_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: HEAL_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: `良姻:令一名手牌数为${x}的角色回复1点体力(可不选)`,
      min: 1,
      max: 1,
      filter: (_view, t) => candidates.includes(t),
    },
    timeout: 15,
  });
  const healTarget = state.localVars[HEAL_KEY] as number | undefined;
  delete state.localVars[HEAL_KEY];
  if (typeof healTarget === 'number' && state.players[healTarget]?.alive) {
    await applyAtom(state, {
      type: '回复体力',
      target: healTarget,
      amount: 1,
      source: ownerId,
    });
  }
}

/** 令 player 弃置一张手牌(强制;超时自动弃首张)。无手牌则跳过。 */
async function discardOne(state: GameState, player: number): Promise<void> {
  const pl = state.players[player];
  if (!pl?.alive || pl.hand.length === 0) return;
  delete state.localVars[DISCARD_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: DISCARD_RT,
    target: player,
    prompt: {
      type: 'useCard',
      title: '良姻:弃置一张牌',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
    mandatory: true,
    timeout: 20,
  });
  let cards = state.localVars[DISCARD_KEY] as string[] | undefined;
  delete state.localVars[DISCARD_KEY];
  // 强制弃牌:超时未回应 → 自动弃首张(不放弃弃牌义务)
  if ((!cards || cards.length === 0) && state.players[player]?.hand.length) {
    cards = state.players[player].hand.slice(0, 1);
  }
  if (cards && cards.length > 0) {
    await applyAtom(state, { type: '弃置', player, cardIds: cards });
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // 移出至暂存区 after-hook(牌移出游戏)
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '移出至暂存区',
    async (ctx) => {
      if (!ctx.state.players[ownerId]?.alive) return;
      if (ctx.state.turn.vars[triggeredKey(ownerId)]) return;
      ctx.state.turn.vars[triggeredKey(ownerId)] = true;
      await performLiangyin(ctx.state, ownerId);
    },
  );

  // 归还暂存牌 after-hook(牌移入游戏)
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '归还暂存牌',
    async (ctx) => {
      if (!ctx.state.players[ownerId]?.alive) return;
      if (ctx.state.turn.vars[triggeredKey(ownerId)]) return;
      ctx.state.turn.vars[triggeredKey(ownerId)] = true;
      await performLiangyin(ctx.state, ownerId);
    },
  );

  // respond:注册到全部座次(弃牌询问可能落到目标座次)。按 requestType 分支。
  for (const p of state.players) {
    const seatId = p.index;
    registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        if (slot.atom.type !== '请求回应') return '当前不需要回应';
        const rt = (slot.atom as { requestType?: string }).requestType;
        if (rt === CONFIRM_RT || rt === MODE_RT) {
          return null;
        }
        if (rt === TARGET_RT || rt === HEAL_RT) {
          if (typeof params.target !== 'number' && !params.targets) {
            return '需要选择一名角色';
          }
          return null;
        }
        if (rt === DISCARD_RT) {
          const cardIds = params.cardIds as string[] | undefined;
          if (!Array.isArray(cardIds) || cardIds.length !== 1) return '请选择一张要弃置的手牌';
          const tp = st.players[seatId];
          if (!tp) return '玩家不存在';
          if (!cardIds.every((id) => typeof id === 'string' && tp.hand.includes(id))) {
            return '牌不在手牌中';
          }
          if (new Set(cardIds).size !== cardIds.length) return 'cardIds 含重复牌';
          return null;
        }
        return '当前不是良姻询问';
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        const rt = (
          slot?.atom as { requestType?: string } | undefined
        )?.requestType;
        if (rt === CONFIRM_RT) {
          st.localVars[CONFIRMED_KEY] =
            params.choice === true || params.confirmed === true;
        } else if (rt === TARGET_RT) {
          const t = extractTarget(params);
          if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
        } else if (rt === MODE_RT) {
          st.localVars[MODE_KEY] = params.choice === true ? '摸' : '弃';
        } else if (rt === DISCARD_RT) {
          st.localVars[DISCARD_KEY] = params.cardIds;
        } else if (rt === HEAL_RT) {
          const t = extractTarget(params);
          if (typeof t === 'number') st.localVars[HEAL_KEY] = t;
        }
      },
    );
  }

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 良姻为被动触发技,无主动 action 按钮需要声明
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
