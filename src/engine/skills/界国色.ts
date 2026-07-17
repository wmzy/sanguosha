// 界国色(界大乔·主动技):出牌阶段限一次，你可以选择一项，然后摸一张牌：
//   1.将一张方片牌当【乐不思蜀】使用；2.弃置一张方片牌和场上一张【乐不思蜀】。
//
// 官方来源:三国杀 OL 界限突破 hero/309(逐字)。
//
// 与标版区别:
//   - 标版:仅"将一张方块牌当【乐不思蜀】使用"(无限次)。
//   - 界版:限一次/回合,二选一 + 摸一张牌:
//     ① 方片牌当乐不思蜀使用(手牌或装备区;距离≤1,不能对自己)
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
  Card,
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { effectiveDistance } from '../distance';

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

/** 界国色可用牌:方块(♦)牌(手牌或装备区) */
function isGuoseCard(card: Card | undefined): boolean {
  return !!card && card.suit === '♦';
}

/** 玩家是否持有某张牌(手牌或装备区)。 */
function ownsCard(
  self: { hand: string[]; equipment: Partial<Record<string, EquipSlot | string>> },
  cardId: string,
): boolean {
  if (self.hand.includes(cardId)) return true;
  return Object.values(self.equipment).some((id) => id === cardId);
}

/** 场上是否存在乐不思蜀 */
function anyLeOnField(state: GameState): boolean {
  return state.players.some((p) => p.pendingTricks.some((t) => t.name === TRICK_NAME));
}

function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as Record<string, unknown>).requestType as string | undefined;
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
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, '界国色')) return '本回合已使用过界国色';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      // 至少一张方片牌(手牌或装备区)
      const ownedIds = [
        ...self.hand,
        ...Object.values(self.equipment).filter((id): id is string => typeof id === 'string'),
      ];
      const hasDiamond = ownedIds.some((id) => isGuoseCard(st.cardMap[id]));
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
      const rt = currentRequestType(st, ownerId);
      if (rt !== OPTION_RT && rt !== USE_RT && rt !== REMOVE_CARD_RT && rt !== REMOVE_TARGET_RT) {
        return '当前不是界国色询问';
      }
      if (rt === OPTION_RT) return null; // confirm:任意 choice

      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不可用';

      if (rt === USE_RT) {
        // 选项①:方片牌 + 目标(≠自己,存活,距离≤1)
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张方片牌';
        if (!ownsCard(self, cardId)) return '牌不在手牌或装备区';
        if (!isGuoseCard(st.cardMap[cardId])) return '需要一张方片牌';
        const target =
          (params.target as number | undefined) ??
          (params.targets as number[] | undefined)?.[0];
        if (typeof target !== 'number') return '请选择目标';
        if (target === ownerId) return '不能对自己使用';
        if (!st.players[target]?.alive) return '目标不存在或已死亡';
        if (effectiveDistance(st, ownerId, target) > 1) return '目标距离超过1';
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
        st.localVars[TARGET_KEY] =
          (params.target as number | undefined) ??
          (params.targets as number[] | undefined)?.[0] ??
          null;
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
      title: '界国色:选一张方片牌当乐不思蜀,选一名距离1内的其他角色',
      cardFilter: {
        filter: (c) => c.suit === '♦',
        min: 1,
        max: 1,
      },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) =>
          t !== ownerId &&
          view.players[t]?.alive === true &&
          effectiveDistance(st, ownerId, t) <= 1,
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

  // 装备区的方片牌:先卸下到手牌(产生 ViewEvent,清除武器距离 vars),再走标准打出流程
  const equipSlotEntry = Object.entries(st.players[ownerId].equipment).find(
    ([, id]) => id === cardId,
  );
  if (equipSlotEntry) {
    await applyAtom(st, {
      type: '卸下',
      player: ownerId,
      slot: equipSlotEntry[0] as EquipSlot,
    });
  }

  // 卡牌进处理区(打出)
  await applyAtom(st, {
    type: '移动牌',
    cardId,
    from: { zone: '手牌', player: ownerId },
    to: { zone: '处理区' },
  });

  // 放置延时锦囊(复用 乐不思蜀 hooks:判定/跳过出牌/无懈)
  const trickCard: Card = st.cardMap[cardId] ?? {
    id: cardId,
    name: TRICK_NAME,
    suit: '♦',
    color: '红',
    rank: 'A',
    type: '锦囊牌',
  };
  await applyAtom(st, {
    type: '添加延时锦囊',
    player: target,
    trick: { name: TRICK_NAME, source: ownerId, card: trickCard },
  });

  // 使用卡进弃牌堆
  await applyAtom(st, {
    type: '移动牌',
    cardId,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
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
  await applyAtom(st, {
    type: '请求回应',
    requestType: REMOVE_TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '界国色:选择要弃置其乐不思蜀的角色',
      min: 1,
      max: 1,
      filter: (view, t) =>
        view.players[t]?.alive === true &&
        view.players[t]?.pendingTricks?.some((id) => {
          const c = view.cardMap[id];
          return c?.name === TRICK_NAME;
        }) === true,
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
  await applyAtom(st, { type: '弃置', player: ownerId, cardIds: [cardId] });

  // 弃置场上乐不思蜀(移除延时锦囊)
  await applyAtom(st, { type: '移除延时锦囊', player: trickTarget, trickName: TRICK_NAME });
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '界国色',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '界国色:选一项后摸一张牌',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
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
  api.defineAction('respond', {
    label: '界国色',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '界国色',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
