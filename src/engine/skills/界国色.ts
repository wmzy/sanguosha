// 界国色(界大乔·主动技):出牌阶段限一次，你可以选择一项，然后摸一张牌：
//   1.将一张方片牌当【乐不思蜀】使用；2.弃置一张方片牌和场上一张【乐不思蜀】。
//
// 官方来源:三国杀 OL 界限突破 hero/309(逐字)。
//
// 与标版区别:
//   - 标版:仅"将一张方块牌当【乐不思蜀】使用"(无限次)。
//   - 界版:限一次/回合,二选一 + 摸一张牌:
//     ① 方片牌当乐不思蜀使用(手牌或装备区;不能对自己,乐无距离限制)
//     ② 弃置一张方片牌(手牌或装备区)+ 弃置场上任意一张乐不思蜀(任意角色判定区)
//   - "然后摸一张牌"是两选项共同的效果(选完一项后必摸一张)。
//
// 实现策略(主动 use action + 多步 请求回应):
//   use action validate:出牌阶段 + 限一次 + 有方片牌。
//   execute:markOncePerTurn → 询问选项(confirm)→ 按选项询问牌/目标 → 执行 → 摸一张牌。
//
// 延时锦囊转化(选项①)复用国色/断粮的独立 use 模型:原卡 id 永驻 cardMap,
// 判定/跳过出牌/无懈抵消由 乐不思蜀.ts 的 hooks 处理(只认 trick.name)。
// 选项②:弃置方片(弃置 atom)+ 移除场上乐(移除延时锦囊 atom)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerAction } from '../core/skill';
import type { SkillModule } from '../types';
import { currentRequestType, defineConfirmAction, engineCanPlayNowReason, firstTarget, requireRequestType } from '../util/skillRuntime';
import { ownsCard, ownedCardIds } from '../util/player-query';
import { isGuoseCard } from './国色';
import { placeDelayedTrickTransform } from './_delayedTrickTransform';

const TRICK_NAME = '乐不思蜀';

// requestType / localVars keys
const OPTION_RT = '界国色/option';
const USE_RT = '界国色/use'; // 选项①:方片牌+目标
const REMOVE_CARD_RT = '界国色/removeCard'; // 选项②:选方片牌弃置
const REMOVE_TARGET_RT = '界国色/removeTarget'; // 选项②:选场上乐所在玩家
const OPTION_KEY = '界国色/option'; // 'use' | 'remove'
const CARD_KEY = '界国色/cardId';
const TARGET_KEY = '界国色/target';
const TRICK_TARGET_KEY = '界国色/trickTarget';

/** 场上是否存在乐不思蜀 */
function _anyLeOnField(state: GameState): boolean {
  return state.players.some((p) => p.pendingTricks.some((t) => t.name === TRICK_NAME));
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界国色',
    description:
      '出牌阶段限一次,选一项后摸一张牌:①方片牌当乐不思蜀使用;②弃方片牌和场上乐不思蜀',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── use action:发动界国色 ──────────────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const playError = engineCanPlayNowReason(st, ownerId);
      if (playError) return playError;
      if (usedThisTurn(st, ownerId, '界国色')) return '本回合已使用过界国色';
      const self = st.players[ownerId];
      // 至少一张方片牌(手牌或装备区)
      const hasDiamond = ownedCardIds(self).some((id) => isGuoseCard(st.cardMap[id]));
      if (!hasDiamond) return '需要一张方片牌';
      return null;
    },
    async (st: GameState, _params: Record<string, Json>): Promise<void> => {
      // 限一次标记:第一个 await 之前设置(防 dispatch 重入)
      await markOncePerTurn(st, ownerId, '界国色');
      await pushFrame(st, '界国色', ownerId, {});

      // ── 1. 询问选项(confirm):确认=①使用,取消=②移除 ──
      delete st.localVars[OPTION_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: OPTION_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '界国色:选择一项(然后摸一张牌)',
          confirmLabel: '①方片当乐使用',
          cancelLabel: '②弃方片+弃场上乐',
        },
        defaultChoice: false,
        timeout: 15,
      });
      const option = st.localVars[OPTION_KEY] as 'use' | 'remove' | null;
      delete st.localVars[OPTION_KEY];

      if (option === 'use') {
        await executeOptionUse(st, ownerId);
      } else {
        await executeOptionRemove(st, ownerId);
      }

      // ── 共同效果:摸一张牌 ──
      if (st.players[ownerId]?.alive) {
        await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
      }

      await popFrame(st);
    },
  );

  // ─── respond:界国色各询问的回应 ──────────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const check = requireRequestType(
        st,
        ownerId,
        [OPTION_RT, USE_RT, REMOVE_CARD_RT, REMOVE_TARGET_RT],
        {
          mismatchError: '当前不是界国色询问',
          noSlotError: '当前不是界国色询问',
          wrongTypeError: '当前不是界国色询问',
        },
      );
      if (check.error) return check.error;
      const rt = check.requestType;
      if (rt === OPTION_RT) return null; // confirm:任意 choice

      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不可用';

      if (rt === USE_RT) {
        // 选项①:方片牌 + 目标(≠自己,存活)。乐不思蜀无距离限制,可对任意其他存活角色使用
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张方片牌';
        if (!ownsCard(self, cardId)) return '牌不在手牌或装备区';
        if (!isGuoseCard(st.cardMap[cardId])) return '需要一张方片牌';
        const target = firstTarget(params);
        if (typeof target !== 'number') return '请选择目标';
        if (target === ownerId) return '不能对自己使用';
        if (!st.players[target]?.alive) return '目标不存在或已死亡';
        // 目标判定区已有乐不思蜀时不可使用(与乐不思蜀自身/国色规则一致)
        if (st.players[target].pendingTricks.some((t) => t.name === TRICK_NAME))
          return '目标判定区已有乐不思蜀';
        return null;
      }

      if (rt === REMOVE_CARD_RT) {
        // 选项②-选牌:方片牌(手牌或装备区)
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张方片牌弃置';
        if (!ownsCard(self, cardId)) return '牌不在手牌或装备区';
        if (!isGuoseCard(st.cardMap[cardId])) return '需要一张方片牌';
        return null;
      }

      // REMOVE_TARGET_RT:选场上乐所在玩家
      const trickTarget = params.target as number | undefined;
      if (typeof trickTarget !== 'number') return '请选择一名角色';
      const tp = st.players[trickTarget];
      if (!tp?.alive) return '目标无效';
      if (!tp.pendingTricks.some((t) => t.name === TRICK_NAME)) {
        return '该角色判定区没有乐不思蜀';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const rt = currentRequestType(st, ownerId);
      const confirmed = params.choice === true || params.confirmed === true;
      if (rt === OPTION_RT) {
        st.localVars[OPTION_KEY] = confirmed ? 'use' : 'remove';
      } else if (rt === USE_RT) {
        st.localVars[CARD_KEY] = params.cardId ?? null;
        // 用 ?? (nullish) 判断:target===0 是合法座次,truthy 写法会错误地丢失座次 0
        st.localVars[TARGET_KEY] = firstTarget(params) ?? null;
      } else if (rt === REMOVE_CARD_RT) {
        st.localVars[CARD_KEY] = params.cardId ?? null;
      } else if (rt === REMOVE_TARGET_RT) {
        st.localVars[TRICK_TARGET_KEY] = params.target ?? null;
      }
    },
  );

  return () => {};
}

// ── 选项①:方片牌当乐不思蜀使用 ──
async function executeOptionUse(st: GameState, ownerId: number): Promise<void> {
  const self = st.players[ownerId];
  if (!self?.alive) return;

  delete st.localVars[CARD_KEY];
  delete st.localVars[TARGET_KEY];
  await applyAtom(st, {
    type: '请求回应',
    requestType: USE_RT,
    target: ownerId,
    prompt: {
      type: 'useCardAndTarget',
      title: '界国色:选一张方片牌当乐不思蜀,选一名其他角色(无距离限制)',
      cardFilter: {
        filter: (c) => c.suit === '♦',
        min: 1,
        max: 1,
      },
      targetFilter: {
        min: 1,
        max: 1,
        // 乐不思蜀无距离限制:排除自己与死亡角色即可(与国色/乐不思蜀一致)
        filter: (view, t) =>
          t !== ownerId && view.players[t]?.alive === true,
      },
    },
    timeout: 20,
  });

  const cardId = st.localVars[CARD_KEY] as string | undefined;
  const target = st.localVars[TARGET_KEY] as number | undefined;
  delete st.localVars[CARD_KEY];
  delete st.localVars[TARGET_KEY];
  if (typeof cardId !== 'string' || typeof target !== 'number') return;
  if (!st.players[target]?.alive) return;

  // 放置延时锦囊(装备区方片牌先卸下;判定/跳过出牌/无懈 hooks 见 乐不思蜀.ts)
  await placeDelayedTrickTransform(st, {
    from: ownerId,
    target,
    cardId,
    trickName: TRICK_NAME,
    fallback: { suit: '♦', color: '红', rank: 'A' },
    allowEquipment: true,
  });
}

// ── 选项②:弃方片牌 + 弃场上乐不思蜀 ──
async function executeOptionRemove(st: GameState, ownerId: number): Promise<void> {
  const self = st.players[ownerId];
  if (!self?.alive) return;

  // 选方片牌弃置
  delete st.localVars[CARD_KEY];
  await applyAtom(st, {
    type: '请求回应',
    requestType: REMOVE_CARD_RT,
    target: ownerId,
    prompt: {
      type: 'useCard',
      title: '界国色:选一张方片牌弃置',
      cardFilter: { filter: (c) => c.suit === '♦', min: 1, max: 1 },
    },
    timeout: 20,
  });
  const cardId = st.localVars[CARD_KEY] as string | undefined;
  delete st.localVars[CARD_KEY];
  if (typeof cardId !== 'string') return;

  // 选场上乐所在玩家
  delete st.localVars[TRICK_TARGET_KEY];
  // 预计算候选座次(权威):view.pendingTricks 仅存 cardId,
  // 经国色/界国色转化的乐不思蜀原卡 name !== '乐不思蜀',filter 按 cardMap.name 查会漏选。
  // 故从 state 直接查 PendingTrick.name,显式传 candidates(投影层不再跑 filter)。
  const trickCandidates = st.players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== ownerId && p.alive && p.pendingTricks.some((t) => t.name === TRICK_NAME))
    .map(({ i }) => i);
  await applyAtom(st, {
    type: '请求回应',
    requestType: REMOVE_TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '界国色:选择要弃置其乐不思蜀的角色',
      min: 1,
      max: 1,
      candidates: trickCandidates,
    },
    timeout: 20,
  });
  const trickTarget = st.localVars[TRICK_TARGET_KEY] as number | undefined;
  delete st.localVars[TRICK_TARGET_KEY];
  if (typeof trickTarget !== 'number') return;
  const tp = st.players[trickTarget];
  if (!tp?.alive) return;
  if (!tp.pendingTricks.some((t) => t.name === TRICK_NAME)) return;

  // 弃置方片牌(弃置 atom 原生支持手牌/装备区跨区域弃牌)
  await applyAtom(st, { type: '弃置', player: ownerId, cardIds: [cardId], voluntary: true });

  // 弃置场上乐不思蜀(移除延时锦囊)
  await applyAtom(st, { type: '移除延时锦囊', player: trickTarget, trickName: TRICK_NAME });
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  defineConfirmAction(api, 'use', {
    label: '界国色',
    title: '界国色:选一项后摸一张牌',
    activeWhen: (ctx) => {
      if (!activeUnlessUsedThisTurn('界国色')(ctx)) return false;
      // 至少有一张方片牌
      const me = ctx.view.players[ctx.perspectiveIdx];
      const hasDiamondInHand = (me?.hand ?? []).some((c) => c.suit === '♦');
      const hasDiamondInEquip = Object.values(me?.equipment ?? {}).some((id) => {
        const c = ctx.view.cardMap[id];
        return c?.suit === '♦';
      });
      return hasDiamondInHand || hasDiamondInEquip;
    },
  });
  defineConfirmAction(api, 'respond', {
    label: '界国色',
    title: '界国色',
    confirmLabel: '确认',
    cancelLabel: '取消',
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
