// 过河拆桥(普通锦囊):
//   出牌阶段,对 1 名其他角色使用(无距离限制)。
//   弃置该角色区域内(手牌、装备区、判定区)的 1 张牌。
//
// 选牌交互(贴近面杀):
//   use 时不指定具体卡 → 移锦囊 → 询问无懈 → 弹选牌面板(pickTargetCard pending) →
//   使用者按区域选:装备/判定(明牌可见,直接选 cardId)或手牌(盲选第 K 张)。
//   手牌盲选是博弈核心:目标可偷偷调整顺序,使用者凭牌背位置推测。
//   重放确定性:盲选时在 actionLog 的当前条目前 splice "设置手牌顺序" 条目。
import type { ActionLogEntry, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule, validateUseCard } from '../skill';
import { askWuxie } from '../wuxie';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '过河拆桥', description: '锦囊:弃置目标一张牌' };
}

/** 在 actionLog 中当前(最后一条)条目之前插入一条"设置手牌顺序"条目。
 *  重放时该条目先执行 → 目标 hand 顺序恢复 → 后续盲选取 hand[K] 确定性正确。
 *  去重:若前一条已是同 target 的设置手牌顺序且 order 一致,跳过(避免重放二次插入)。 */
function spliceHandOrderEntry(state: GameState, target: number): void {
  const player = state.players[target];
  if (!player) return;
  const order = [...player.hand];
  if (order.length === 0) return;
  const log = state.actionLog;
  const myIndex = log.length - 1; // 当前条目位置
  if (myIndex > 0) {
    const prev = log[myIndex - 1];
    if (
      prev.message.skillId === '系统规则' &&
      prev.message.actionType === '设置手牌顺序' &&
      (prev.message.params.target as number) === target
    ) {
      const prevOrder = prev.message.params.order as string[];
      if (Array.isArray(prevOrder) && prevOrder.length === order.length &&
          prevOrder.every((id, i) => id === order[i])) {
        return; // 顺序未变,跳过
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

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '过河拆桥', requireTarget: true })
        ?? (Array.isArray(params.targets) && (params.targets as number[]).every(t => state.players[t]?.alive === true) ? null : '目标不合法');
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '过河拆桥', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.targets as number[])?.[0] ?? params.target as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击(单目标锦囊:抵消整个锦囊)
      try {
        const cancelled = await askWuxie(state, target);
        if (!cancelled) {
          const targetPlayer = state.players[target];
          if (targetPlayer) {
            // 弹选牌面板:使用者从目标区域选一张牌
            await runPickTargetCard(state, from, target, targetPlayer, /*obtain=*/ false);
          }
        }
        // 移锦囊到弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        popFrame(state);
      }
    }, );

  // ── 选牌 respond:使用者从目标区域选一张牌 ──
  registerAction(skill.id, ownerId, 'respond', (state: GameState, params: Record<string, Json>) => {
    const slot = state.pendingSlots.get(ownerId);
    if (!slot) return '当前不需要回应';
    if (slot.atom.type !== '请求回应') return '当前不是选牌窗口';
    const atom = slot.atom as { requestType?: string };
    if (atom.requestType !== '过河拆桥_选牌') return '当前不是选牌窗口';
    const zone = params.zone;
    if (zone === 'equipment' || zone === 'judge') {
      if (typeof params.cardId !== 'string') return 'cardId required';
    } else if (zone === 'hand') {
      if (typeof params.handIndex !== 'number') return 'handIndex required';
    } else {
      return 'zone required (equipment|judge|hand)';
    }
    return null;
  }, async (state: GameState, params: Record<string, Json>) => {
    state.localVars['选牌/结果'] = { zone: params.zone, cardId: params.cardId ?? null, handIndex: params.handIndex ?? null };
  });

  return () => {};
}

/** 选牌面板:弹 pickTargetCard pending,超时兜底(明牌优先,否则盲选 hand[0])。 */
async function runPickTargetCard(
  state: GameState,
  from: number,
  target: number,
  targetPlayer: GameState['players'][number],
  obtain: boolean,
): Promise<void> {
  const equipment = Object.entries(targetPlayer.equipment)
    .filter(([, id]) => typeof id === 'string')
    .map(([slot, id]) => ({ slot, cardId: id as string, cardName: state.cardMap[id as string]?.name ?? '?' }));
  const judge = targetPlayer.pendingTricks.map(t => ({ cardId: t.card.id, cardName: t.card.name }));
  const handCount = targetPlayer.hand.length;

  // 超时默认选择:明牌优先(装备第一张→判定第一张),否则手牌[0]
  const defaultZone = equipment.length > 0
    ? { zone: 'equipment', cardId: equipment[0].cardId }
    : judge.length > 0
      ? { zone: 'judge', cardId: judge[0].cardId }
      : { zone: 'hand', handIndex: 0 };

  // 手牌存在时,splice 顺序快照(重放确定性)
  if (handCount > 0) {
    spliceHandOrderEntry(state, target);
  }

  const requestType = obtain ? '顺手牵羊_选牌' : '过河拆桥_选牌';
  await applyAtom(state, {
    type: '请求回应',
    requestType,
    target: from,
    prompt: {
      type: 'pickTargetCard',
      title: obtain ? '选择获得的目标牌' : '选择弃置的目标牌',
      target,
      equipment,
      judge,
      handCount,
    },
    defaultChoice: defaultZone as unknown as Json,
    timeout: 20,
  });

  // 读取使用者选择
  const result = state.localVars['选牌/结果'] as { zone: string; cardId: string | null; handIndex: number | null } | undefined;
  delete state.localVars['选牌/结果'];
  const zone = result?.zone ?? (defaultZone as { zone: string }).zone;

  if (zone === 'equipment') {
    const cardId = (result?.cardId ?? defaultZone.cardId) as string;
    await applyAtom(state, { type: '弃置', player: target, cardIds: [cardId] });
  } else if (zone === 'judge') {
    const cardId = (result?.cardId ?? defaultZone.cardId) as string;
    const trick = targetPlayer.pendingTricks.find(t => t.card.id === cardId);
    if (trick) {
      await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: trick.name });
      await applyAtom(state, { type: '弃置', player: target, cardIds: [cardId] });
    }
  } else {
    // hand:盲选
    const handIndex = result?.handIndex ?? 0;
    const cardToDiscard = targetPlayer.hand[handIndex] ?? targetPlayer.hand[0];
    if (cardToDiscard) {
      await applyAtom(state, { type: '弃置', player: target, cardIds: [cardToDiscard] });
    }
  }
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '过河拆桥',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '过河拆桥',
      cardFilter: { filter: (c) => c.name === '过河拆桥', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
}
