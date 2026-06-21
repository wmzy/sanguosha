// 顺手牵羊(普通锦囊):
//   出牌阶段,对距离 1 内的一名其他角色使用,获得其一张牌。
//
// 选牌交互(贴近面杀):
//   - 明牌区(装备):use 时通过 params.equipCardId 直接指定卡 ID,后端操作该卡。
//   - 手牌:apply 内向使用者发起 pickHandIndex 询问,使用者凭牌背位置盲选第 K 张,
//     引擎取 targetPlayer.hand[K]。博弈核心同过河拆桥。
//   - 重放确定性:盲选 execute 在 actionLog 当前 use 条目前 splice 一条"设置手牌顺序"条目。
import type { ActionLogEntry, FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '顺手牵羊', description: '锦囊:获得目标一张牌' };
}

/** 在 actionLog 中当前(最后一条)条目之前插入一条"设置手牌顺序"条目(同过河拆桥)。 */
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
      if (Array.isArray(prevOrder) && prevOrder.length === order.length &&
          prevOrder.every((id, i) => id === order[i])) {
        return;
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
    const target = params.target as number | undefined ?? (params.targets as number[] | undefined)?.[0];
    if (typeof target !== 'number') return 'target required';
    const cardInHand = !!self?.hand.includes(params.cardId);
    const cardNameOk = state.cardMap[params.cardId]?.name === '顺手牵羊';
    const notSelf = target !== ownerId;
    // 距离检查
    const inRange = effectiveDistance(state, ownerId, target as number) <= 1;
    const targetPlayer = state.players[target];
    const targetAlive = targetPlayer?.alive === true;
    const targetHasHand = !!targetPlayer && targetPlayer.hand.length > 0;
    const targetHasEquip = !!targetPlayer && Object.keys(targetPlayer.equipment).length > 0;
    const targetHasCard = targetHasHand || targetHasEquip;
    // 明牌区选牌校验:若指定 equipCardId,必须存在于目标的装备区
    if (typeof params.equipCardId === 'string') {
      const inEquip = targetPlayer && Object.values(targetPlayer.equipment).includes(params.equipCardId);
      if (!inEquip) return 'equipCardId 不在目标装备区';
    }
    const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && notSelf && inRange && targetAlive && targetHasCard;
    return ok ? null : '顺手牵羊使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      pushFrame(state, '顺手牵羊', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0] as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击:锦囊异常安全 + localVars 初始化/清理
      state.localVars['无懈/被抵消'] = false;
      try {
        await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
        if (!state.localVars['无懈/被抵消']) {
          const targetPlayer = state.players[target];
          if (targetPlayer) {
            // 明牌区优先:若 use 时指定了 equipCardId,直接获得该装备
            const equipCardId = params.equipCardId as string | undefined;
            if (equipCardId) {
              await applyAtom(state, { type: '获得', player: from, cardId: equipCardId, from: target });
            } else if (targetPlayer.hand.length > 0) {
              // 手牌盲选:splice 顺序快照 → 询问使用者选第几张
              spliceHandOrderEntry(state, target);
              await applyAtom(state, {
                type: '请求回应',
                requestType: '顺手牵羊_盲选',
                target: from,
                prompt: {
                  type: 'pickHandIndex',
                  title: '选择获得的手牌位置',
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
              const cardToObtain = targetPlayer.hand[handIndex] ?? targetPlayer.hand[0];
              if (cardToObtain) {
                await applyAtom(state, { type: '获得', player: from, cardId: cardToObtain, from: target });
              }
            } else {
              // 无明牌指定且无手牌 → 获得装备区第一槽(兜底)
              for (const slot of ['武器', '防具', '进攻马', '防御马', '宝物'] as const) {
                const id = targetPlayer.equipment?.[slot];
                if (id) {
                  await applyAtom(state, { type: '获得', player: from, cardId: id, from: target });
                  break;
                }
              }
            }
          }
        }
        // 移锦囊到弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
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
    if (atom.requestType !== '顺手牵羊_盲选') return '当前不是盲选窗口';
    const handIndex = params.handIndex;
    if (typeof handIndex !== 'number') return 'handIndex required';
    return null;
  }, async (state: GameState, params: Record<string, Json>) => {
    state.localVars['盲选/handIndex'] = params.handIndex;
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '顺手牵羊',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '顺手牵羊',
      cardFilter: { filter: (c) => c.name === '顺手牵羊', min: 1, max: 1 },
      targetFilter: {
        min: 1, max: 1,
        // 距离≤1 检查:filter 仅为前端 UI 提示,后端 validate 独立校验
        filter: (view: GameView, t: number) => viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
      },
    },
  });
}
