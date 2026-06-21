// 过河拆桥(普通锦囊):
//   出牌阶段,对 1 名其他角色使用(无距离限制)。
//   弃置该角色区域内(手牌、装备区、判定区)的 1 张牌。
//
// 选牌交互(贴近面杀):
//   - 明牌区(装备/判定):use 时通过 params.equipCardId 直接指定卡 ID,后端操作该卡。
//   - 手牌:apply 内向使用者发起 pickHandIndex 询问,使用者凭牌背位置盲选第 K 张,
//     引擎取 targetPlayer.hand[K]。这正是博弈核心——目标可偷偷调整手牌顺序,
//     使用者根据历史推测,目标可反向博弈。
//   - 为保证重放确定性,盲选 execute 会在 actionLog 的当前 use 条目之前 splice 一条
//     "设置手牌顺序" 条目(记录目标此刻的 hand 顺序),重放时先恢复顺序再盲选。
import type { ActionLogEntry, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

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
  const myIndex = log.length - 1; // 当前 use 条目位置
  // 去重:前一条若是同目标的设置手牌顺序且 order 一致,不重复插入
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
    id: `order-${state.seq}-${target}`,
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

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0;
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (!Array.isArray(params.targets) || typeof params.targets[0] !== 'number') return 'target required';
      const targetIdx = params.targets[0];
      const cardInHand = !!self?.hand.includes(params.cardId);
      const cardNameOk = state.cardMap[params.cardId]?.name === '过河拆桥';
      const targetPlayer = state.players[targetIdx];
      const notSelf = targetIdx !== ownerId;
      const targetAlive = targetPlayer?.alive === true;
      const targetHasCards = !!targetPlayer && (targetPlayer.hand.length > 0 || Object.keys(targetPlayer.equipment).length > 0 || targetPlayer.pendingTricks.length > 0);
      // 明牌区选牌校验:若指定 equipCardId,必须存在于目标的装备区或判定区
      if (typeof params.equipCardId === 'string') {
        const inEquip = targetPlayer && Object.values(targetPlayer.equipment).includes(params.equipCardId);
        const inJudge = targetPlayer && targetPlayer.pendingTricks.some(t => t.card.id === params.equipCardId);
        if (!inEquip && !inJudge) return 'equipCardId 不在目标明牌区';
      }
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && notSelf && targetAlive && targetHasCards;
      return ok ? null : '过河拆桥使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '过河拆桥', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.targets as number[])?.[0] ?? params.target as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击:锦囊异常安全 + localVars 初始化/清理
      state.localVars['无懈/被抵消'] = false;
      try {
        await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
        if (!state.localVars['无懈/被抵消']) {
          const targetPlayer = state.players[target];
          if (targetPlayer) {
            // 明牌区优先:若 use 时指定了 equipCardId,直接弃该卡
            const equipCardId = params.equipCardId as string | undefined;
            if (equipCardId) {
              // 判定区
              const inJudge = targetPlayer.pendingTricks.some(t => t.card.id === equipCardId);
              if (inJudge) {
                await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: targetPlayer.pendingTricks.find(t => t.card.id === equipCardId)!.name });
                await applyAtom(state, { type: '弃置', player: target, cardIds: [equipCardId] });
              } else {
                await applyAtom(state, { type: '弃置', player: target, cardIds: [equipCardId] });
              }
            } else if (targetPlayer.hand.length > 0) {
              // 手牌盲选:splice 顺序快照 → 询问使用者选第几张
              spliceHandOrderEntry(state, target);
              await applyAtom(state, {
                type: '请求回应',
                requestType: '过河拆桥_盲选',
                target: from,
                prompt: {
                  type: 'pickHandIndex',
                  title: '选择弃置的手牌位置',
                  target,
                  handCount: targetPlayer.hand.length,
                },
                defaultChoice: 0,
                timeout: 15,
              });
              // 使用者 respond 的 handIndex(0-based),存于 localVars
              const handIndex = typeof state.localVars['盲选/handIndex'] === 'number'
                ? (state.localVars['盲选/handIndex'] as number)
                : 0;
              delete state.localVars['盲选/handIndex'];
              const cardToDiscard = targetPlayer.hand[handIndex] ?? targetPlayer.hand[0];
              if (cardToDiscard) {
                await applyAtom(state, { type: '弃置', player: target, cardIds: [cardToDiscard] });
              }
            } else if (targetPlayer.pendingTricks.length > 0) {
              // 无明牌指定且无手牌 → 判定区优先(延时锦囊)
              const trickName = targetPlayer.pendingTricks[0].name;
              const trickCardId = targetPlayer.pendingTricks[0].card.id;
              await applyAtom(state, { type: '移除延时锦囊', player: target, trickName });
              await applyAtom(state, { type: '弃置', player: target, cardIds: [trickCardId] });
            } else {
              // 无明牌指定且无手牌无判定区 → 弃装备区第一槽(兜底)
              for (const slot of ['武器', '防具', '进攻马', '防御马', '宝物'] as const) {
                const id = targetPlayer.equipment?.[slot];
                if (id) {
                  await applyAtom(state, { type: '弃置', player: target, cardIds: [id] });
                  break;
                }
              }
            }
          }
        }
        // 移锦囊到弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        // 异常时保证处理区清理与状态恢复
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        delete state.localVars['无懈/被抵消'];
        popFrame(state);
      }
    }, );

  // ── 盲选 respond:使用者选第几张手牌(handIndex 0-based) ──
  registerAction(_skill.id, ownerId, 'respond', (state: GameState, params: Record<string, Json>) => {
    const slot = state.pendingSlots.get(ownerId);
    if (!slot) return '当前不需要回应';
    if (slot.atom.type !== '请求回应') return '当前不是盲选窗口';
    const atom = slot.atom as { requestType?: string };
    if (atom.requestType !== '过河拆桥_盲选') return '当前不是盲选窗口';
    const handIndex = params.handIndex;
    if (typeof handIndex !== 'number') return 'handIndex required';
    return null;
  }, async (state: GameState, params: Record<string, Json>) => {
    // 把使用者选的下标写入 localVars,父 execute 读出后取 hand[handIndex]
    state.localVars['盲选/handIndex'] = params.handIndex;
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
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
