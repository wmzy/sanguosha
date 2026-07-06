// 顺手牵羊(普通锦囊):
//   出牌阶段,对距离 1 内的一名其他角色使用,获得其区域内(手牌/装备区/判定区)的一张牌。
//
// 选牌交互同过河拆桥:出牌 → 询问无懈 → 弹选牌面板 → 使用者按区域选。
// 区别:获得(而非弃置)目标牌。判定区延时锦囊也可被获得。
import type { ActionLogEntry, FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, validateUseCard } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';
import { 询问无懈可击 } from '../无懈可击';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '顺手牵羊', description: '锦囊:获得目标一张牌' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return (
        validateUseCard(state, ownerId, params, { cardName: '顺手牵羊' }) ??
        (() => {
          const target =
            (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
          if (target === undefined) return '目标不合法';
          if (target === ownerId) return '不能对自己使用';
          if (!state.players[target]?.alive) return '目标已死亡';
          // 奇才(黄月英):使用锦囊牌无距离限制 → 跳过距离校验
          const ignoreDistance = !!state.players[ownerId]?.tags.includes(
            '奇才/无距离限制',
          );
          if (!ignoreDistance && effectiveDistance(state, ownerId, target) > 1)
            return '距离太远';
          const p = state.players[target];
          if (!p) return '目标不合法';
          const hasCards =
            p.hand.length > 0 || Object.keys(p.equipment).length > 0 || p.pendingTricks.length > 0;
          if (!hasCards) return '目标无可获取的牌';
          return null;
        })()
      );
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      await pushFrame(state, '顺手牵羊', from, { ...params });
      const cardId = params.cardId as string;
      // validate 闭包已保证 target 存在;此处断言必要,eslint 对 ?? 链有误报

      const target = ((params.target as number | undefined) ??
        (params.targets as number[] | undefined)?.[0]) as number;
      // 移锦囊到处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      // 询问无懈可击(单目标锦囊:抵消整个锦囊)
      try {
        const cancelled = await 询问无懈可击(state, target);
        if (!cancelled) {
          const targetPlayer = state.players[target];
          if (targetPlayer) {
            await runPickTargetCardObtain(state, from, target, targetPlayer);
          }
        }
        // 移锦囊到弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        if (frameCards(state).includes(cardId)) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        await popFrame(state);
      }
    },
  );

  // ── 选牌 respond:使用者从目标区域选一张牌 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是选牌窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '顺手牵羊_选牌') return '当前不是选牌窗口';
      const zone = params.zone;
      if (zone === 'equipment' || zone === 'judge') {
        if (typeof params.cardId !== 'string') return 'cardId required';
      } else if (zone === 'hand') {
        if (typeof params.handIndex !== 'number') return 'handIndex required';
      } else {
        return 'zone required (equipment|judge|hand)';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      state.localVars['选牌/结果'] = {
        zone: params.zone,
        cardId: params.cardId ?? null,
        handIndex: params.handIndex ?? null,
      };
    },
  );

  return () => {};
}

/** 在 actionLog 当前条目前 splice "设置手牌顺序"(重放确定性,逻辑同过河拆桥)。 */
function spliceHandOrderEntry(state: GameState, target: number): void {
  const player = state.players[target];
  if (!player) return;
  const order = [...player.hand];
  if (order.length === 0) return;
  const log = state.actionLog;
  const myIndex = log.length - 1;
  if (myIndex > 0) {
    const prev = log[myIndex - 1];
    if (
      prev.message.skillId === '系统规则' &&
      prev.message.actionType === '设置手牌顺序' &&
      (prev.message.params.target as number) === target
    ) {
      const prevOrder = prev.message.params.order as string[];
      if (
        Array.isArray(prevOrder) &&
        prevOrder.length === order.length &&
        prevOrder.every((id, i) => id === order[i])
      ) {
        return;
      }
    }
  }
  const entry: ActionLogEntry = {
    id: `order-${log.length}-${target}`,
    timestamp: Date.now() - state.startedAt,
    message: {
      skillId: '系统规则',
      actionType: '设置手牌顺序',
      ownerId: log[myIndex].message.ownerId,
      params: { target, order },
      baseSeq: log[myIndex].baseSeq,
    },
    baseSeq: log[myIndex].baseSeq,
  };
  log.splice(myIndex, 0, entry);
}

/** 选牌面板(获得):弹 pickTargetCard pending,超时兜底,获得而非弃置。 */
async function runPickTargetCardObtain(
  state: GameState,
  from: number,
  target: number,
  targetPlayer: GameState['players'][number],
): Promise<void> {
  const equipment = Object.entries(targetPlayer.equipment)
    .filter(([, id]) => typeof id === 'string')
    .map(([slot, id]) => ({ slot, cardId: id, cardName: state.cardMap[id]?.name ?? '?' }));
  const judge = targetPlayer.pendingTricks.map((t) => ({
    cardId: t.card.id,
    cardName: t.card.name,
  }));
  const handCount = targetPlayer.hand.length;

  // 超时默认:明牌优先,否则手牌[0]
  const defaultZone =
    equipment.length > 0
      ? { zone: 'equipment', cardId: equipment[0].cardId }
      : judge.length > 0
        ? { zone: 'judge', cardId: judge[0].cardId }
        : { zone: 'hand', handIndex: 0 };

  if (handCount > 0) {
    spliceHandOrderEntry(state, target);
  }

  await applyAtom(state, {
    type: '请求回应',
    requestType: '顺手牵羊_选牌',
    target: from,
    prompt: {
      type: 'pickTargetCard',
      title: '选择获得的目标牌',
      target,
      equipment,
      judge,
      handCount,
    },
    defaultChoice: defaultZone as unknown as Json,
    timeout: 20,
  });

  const result = state.localVars['选牌/结果'] as
    | { zone: string; cardId: string | null; handIndex: number | null }
    | undefined;
  delete state.localVars['选牌/结果'];
  const zone = result?.zone ?? (defaultZone as { zone: string }).zone;

  if (zone === 'equipment') {
    const cardId = (result?.cardId ?? defaultZone.cardId) as string;
    await applyAtom(state, { type: '获得', player: from, cardId, from: target });
  } else if (zone === 'judge') {
    // 获得判定区延时锦囊:先移除延时锦囊,再获得该卡
    const cardId = (result?.cardId ?? defaultZone.cardId) as string;
    const trick = targetPlayer.pendingTricks.find((t) => t.card.id === cardId);
    if (trick) {
      await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: trick.name });
      await applyAtom(state, { type: '获得', player: from, cardId, from: target });
    }
  } else {
    // hand:盲选
    const handIndex = result?.handIndex ?? 0;
    const cardToObtain = targetPlayer.hand[handIndex] ?? targetPlayer.hand[0];
    if (cardToObtain) {
      await applyAtom(state, { type: '获得', player: from, cardId: cardToObtain, from: target });
    }
  }
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '顺手牵羊',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '顺手牵羊',
      cardFilter: { filter: (c) => c.name === '顺手牵羊', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 距离≤1 检查:filter 仅为前端 UI 提示,后端 validate 独立校验
        filter: (view: GameView, t: number) =>
          viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
      },
    },
  });
}
