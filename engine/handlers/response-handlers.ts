import type {
  GameState,
  GameAction,
  EngineResult,
  Atom,
  PendingResponseWindow,
  PendingSelectCard,
  PendingHarvestSelection,
} from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';
import { makeServerEvent } from '../event';
import { applyAtoms, applyDamage } from './engine-utils';
import { createPendingId } from '../atoms/pending';
import { isCardValidResponse } from '../validate';

/**
 * 创建抢占式（并发）无懈可击响应窗口。
 * 所有可响应的玩家同时被询问，任一玩家可抢先出无懈可击。
 */
export function createConcurrentTrickResponse(
  state: GameState,
  params: {
    sourceCard: string;
    attacker: string;
    trickTarget?: string;
    responders: string[];
    depth?: number;
    judgmentContext?: { player: string; trickIndex: number };
    aoeResume?: { attacker: string; remainingTargets: string[]; requiredCard: string; sourceCard: string };
  },
): PendingResponseWindow {
  const { sourceCard, attacker, trickTarget, responders, depth, judgmentContext, aoeResume } = params;
  const timeout = TIMEOUT_DEFAULTS.trickResponse;

  // defender 设为 responders[0]，保持向后兼容
  const defender = responders[0];
  const defenderPlayer = getPlayer(state, defender);
  const validCards = defenderPlayer.hand.filter(id => state.cardMap[id]?.name === '无懈可击');

  return {
    id: createPendingId(),
    type: 'responseWindow',
    window: {
      type: 'trickResponse',
      attacker,
      defender,
      validCards,
      sourceCard,
      trickTarget,
      responders,
      passedResponders: [],
      depth: depth ?? 0,
      judgmentContext,
      aoeResume,
      timeout,
      deadline: Date.now() + timeout,
    },
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: defender },
  };
}

export function resolveResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  switch (pending.window.type) {
    case 'killResponse':
      return resolveKillResponse(state, action, pending);
    case 'aoeResponse':
      return resolveAoeResponse(state, action, pending);
    case 'trickResponse':
      return resolveTrickResponse(state, action, pending);
    case 'duelResponse':
      return resolveDuelResponse(state, action, pending);
    case 'dyingResponse':
      return resolveDyingResponse(state, action, pending);
  }
}

function resolveKillResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: '杀响应窗口需要 respond 动作' };
  }

  const { attacker, defender } = pending.window;
  if (action.player !== defender) {
    return { state, events: [], error: '只有被杀者可以响应' };
  }

  // ── 出闪 → 闪避 ──
  if (action.cardId) {
    const responder = getPlayer(state, defender);
    if (!responder.hand.includes(action.cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }
    if (!isCardValidResponse(state, action.cardId, 'killResponse', defender)) {
      return { state, events: [], error: '只能用闪（或可当闪使用的牌）响应杀' };
    }

    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player: defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    const dodgedEvent = makeServerEvent('killDodged', {
      attacker: attacker ?? '',
      defender,
    });
    return { state: result.state, events: [...result.events, dodgedEvent] };
  }

  // ── 不出闪 → 受到伤害 ──
  let damageAmount = 1;
  if (attacker) {
    const attackerState = getPlayer(state, attacker);
    if (attackerState.vars['裸衣/active'] === true) {
      damageAmount = 2;
    }
  }

  const { state: popState, events: popEvents } = applyAtoms(state, [{ type: 'popPending' }]);
  const damageResult = applyDamage(
    popState, defender, damageAmount,
    attacker ?? undefined, pending.window.sourceCard,
  );
  const hitEvent = makeServerEvent('killHit', {
    attacker: attacker ?? '',
    defender,
  });

  return {
    state: damageResult.state,
    events: [...popEvents, ...damageResult.events, hitEvent],
  };
}

function resolveAoeResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: 'AOE 响应窗口需要 respond 动作' };
  }

  const { defender, attacker, remainingTargets, requiredCard, sourceCard } = pending.window;

  // 处理当前玩家的响应
  if (action.cardId) {
    const atoms: Atom[] = [
      { type: 'moveCard', cardId: action.cardId, from: { zone: 'hand', player: defender }, to: { zone: 'discardPile' } },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    const s = result.state;
    const events = result.events;

    // 还有剩余玩家需要响应 → 创建下一个 aoeResponse
    if (remainingTargets && remainingTargets.length > 0 && attacker && requiredCard && sourceCard) {
      return startAoeTargetWuxie(s, { attacker, remainingTargets, requiredCard, sourceCard });
    }
    return { state: s, events };
  }

  const { state: popState, events: popEvents } = applyAtoms(state, [{ type: 'popPending' }]);
  const damageResult = applyDamage(
    popState, defender, 1,
    attacker ?? undefined, sourceCard,
  );
  const allEvents = [...popEvents, ...damageResult.events];

  const hasRemainingTargets = !!(remainingTargets && remainingTargets.length > 0 && attacker && requiredCard && sourceCard);

  if (damageResult.state.pending?.type === 'dyingWindow' && hasRemainingTargets) {
    const resumeAoe = { attacker, remainingTargets, requiredCard, sourceCard };
    return {
      state: { ...damageResult.state, pending: { ...damageResult.state.pending, resumeAoe } },
      events: allEvents,
    };
  }

  if (damageResult.state.pending !== null) {
    return { state: damageResult.state, events: allEvents };
  }

  if (hasRemainingTargets) {
    return startAoeTargetWuxie(damageResult.state, {
      attacker,
      remainingTargets,
      requiredCard,
      sourceCard,
    });
  }

  return { state: damageResult.state, events: allEvents };
}

function resolveTrickResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: '锦囊响应窗口需要 respond 动作' };
  }

  const responders = pending.window.responders;
  if (responders && responders.length > 0) {
    return resolveConcurrentTrickResponse(state, action, pending);
  }

  return resolveLegacyTrickResponse(state, action, pending);
}

function resolveConcurrentTrickResponse(
  state: GameState,
  action: GameAction & { type: 'respond' },
  pending: PendingResponseWindow,
): EngineResult {
  const { responders, passedResponders, depth, sourceCard, attacker, trickTarget, judgmentContext, aoeResume } = pending.window;
  const currentDepth = depth ?? 0;

  if (!responders || responders.length === 0) {
    return { state, events: [], error: 'trickResponse 并发模式缺少 responders' };
  }

  const currentPassed = passedResponders ?? [];

  // 验证：action.player 必须在 responders 且不在 passedResponders
  if (!responders.includes(action.player)) {
    return { state, events: [], error: '你不是可响应的玩家' };
  }
  if (currentPassed.includes(action.player)) {
    return { state, events: [], error: '你已经 pass 了' };
  }

  // 出了无懈可击
  if (action.cardId) {
    const card = state.cardMap[action.cardId];
    if (card?.name !== '无懈可击') {
      return { state, events: [], error: '只能用无懈可击响应锦囊' };
    }
    const responder = getPlayer(state, action.player);
    if (!responder.hand.includes(action.cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }

    // 弃掉无懈可击，弹出当前 pending
    state = applyAtoms(state, [
      {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player: action.player },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ]).state;

    // 创建嵌套 trickResponse：询问其他人是否对这张无懈可击再出无懈可击
    const aliveOthers = getAlivePlayerNames(state).filter(p => p !== action.player);

    if (aliveOthers.length === 0) {
      return resolveTrickResolution(state, currentDepth + 1, sourceCard!, attacker!, trickTarget, judgmentContext, aoeResume);
    }

    const nestedPending = createConcurrentTrickResponse(state, {
      sourceCard: sourceCard!,
      attacker: action.player,
      trickTarget,
      responders: aliveOthers,
      depth: currentDepth + 1,
      judgmentContext,
      aoeResume,
    });

    return applyAtoms(state, [{ type: 'pushPending', action: nestedPending }]);
  }

  // Pass：不出牌
  const newPassed = [...currentPassed, action.player];
  const remaining = responders.filter(p => !newPassed.includes(p));

  if (remaining.length > 0) {
    // 还有未响应的玩家，更新 pending：弹旧的推新的
    state = applyAtoms(state, [{ type: 'popPending' }]).state;
    const nextDefender = remaining[0];
    const nextDefenderPlayer = getPlayer(state, nextDefender);
    const validCards = nextDefenderPlayer.hand.filter(id => state.cardMap[id]?.name === '无懈可击');
    const timeout = TIMEOUT_DEFAULTS.trickResponse;

    const updatedPending: PendingResponseWindow = {
      id: createPendingId(),
      type: 'responseWindow',
      window: {
        type: 'trickResponse',
        attacker,
        defender: nextDefender,
        validCards,
        sourceCard,
        trickTarget,
        responders,
        passedResponders: newPassed,
        depth: currentDepth,
        judgmentContext,
        aoeResume,
        timeout,
        deadline: Date.now() + timeout,
      },
      timeout,
      deadline: Date.now() + timeout,
      onTimeout: { type: 'respond', player: nextDefender },
    };

    return applyAtoms(state, [{ type: 'pushPending', action: updatedPending }]);
  }

  // 所有人都 pass → 根据深度判定结果
  state = applyAtoms(state, [{ type: 'popPending' }]).state;
  return resolveTrickResolution(state, currentDepth, sourceCard!, attacker!, trickTarget, judgmentContext, aoeResume);
}

function resolveTrickResolution(
  state: GameState,
  depth: number,
  sourceCard: string,
  attacker: string,
  trickTarget?: string,
  judgmentContext?: { player: string; trickIndex: number },
  aoeResume?: { attacker: string; remainingTargets: string[]; requiredCard: string; sourceCard: string },
): EngineResult {
  // depth EVEN → 锦囊放行；depth ODD → 锦囊被取消
  const negated = depth % 2 !== 0;

  if (judgmentContext) {
    return resolveJudgmentTrickResponse(state, negated, state.cardMap[sourceCard]?.name ?? '', judgmentContext);
  }

  if (aoeResume) {
    if (negated) {
      const nextTargets = aoeResume.remainingTargets.slice(1);
      if (nextTargets.length === 0) return { state, events: [] };
      return startAoeTargetWuxie(state, {
        attacker: aoeResume.attacker,
        remainingTargets: nextTargets,
        requiredCard: aoeResume.requiredCard,
        sourceCard: aoeResume.sourceCard,
      });
    }
    return executeAoeResume(state, aoeResume);
  }

  if (negated) return { state, events: [] };

  return executeTrickEffect(state, {
    sourceCard,
    attacker,
    trickTarget,
  });
}

export function executeTrickEffect(
  state: GameState,
  params: {
    sourceCard: string;
    attacker: string;
    trickTarget?: string;
  },
): EngineResult {
  const { sourceCard, attacker, trickTarget } = params;
  const trickCard = state.cardMap[sourceCard];
  if (!trickCard) return { state, events: [], error: '源卡牌不存在' };
  const trickName = trickCard.name;
  const target = trickTarget;

  switch (trickName) {
    case '过河拆桥': {
      if (!target) return { state, events: [] };
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) return { state, events: [] };
      const selectPending: PendingSelectCard = {
        id: createPendingId(),
        type: 'selectCard',
        player: attacker,
        target,
        cardIds: targetPlayer.hand,
        min: 1,
        max: 1,
        sourceCard,
        mode: 'discard',
        timeout: TIMEOUT_DEFAULTS.selectCard,
        deadline: Date.now() + TIMEOUT_DEFAULTS.selectCard,
        onTimeout: { type: 'respond', player: attacker, cardIds: [targetPlayer.hand[0]] },
      };
      return applyAtoms(state, [{ type: 'pushPending', action: selectPending }]);
    }

    case '顺手牵羊': {
      if (!target) return { state, events: [] };
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) return { state, events: [] };
      const selectPending: PendingSelectCard = {
        id: createPendingId(),
        type: 'selectCard',
        player: attacker,
        target,
        cardIds: targetPlayer.hand,
        min: 1,
        max: 1,
        sourceCard,
        mode: 'steal',
        timeout: TIMEOUT_DEFAULTS.selectCard,
        deadline: Date.now() + TIMEOUT_DEFAULTS.selectCard,
        onTimeout: { type: 'respond', player: attacker, cardIds: [targetPlayer.hand[0]] },
      };
      return applyAtoms(state, [{ type: 'pushPending', action: selectPending }]);
    }

    case '决斗': {
      if (!target) return { state, events: [] };
      const validKills = getPlayer(state, target).hand.filter(
        id => state.cardMap[id]?.name === '杀',
      );
      const duelTimeout = TIMEOUT_DEFAULTS.killResponse;
      const duelWindow: PendingResponseWindow = {
        id: createPendingId(),
        type: 'responseWindow',
        window: {
          type: 'duelResponse',
          attacker,
          defender: target,
          validCards: validKills,
          sourceCard,
          timeout: duelTimeout,
          deadline: Date.now() + duelTimeout,
        },
        timeout: duelTimeout,
        deadline: Date.now() + duelTimeout,
        onTimeout: { type: 'respond', player: target },
      };
      return applyAtoms(state, [{ type: 'pushPending', action: duelWindow }]);
    }

    case '乐不思蜀': {
      if (!target) return { state, events: [] };
      const trick = { name: '乐不思蜀', source: attacker, card: trickCard };
      return applyAtoms(state, [
        { type: 'addPendingTrick', player: target, trick },
      ]);
    }

    case '兵粮寸断': {
      if (!target) return { state, events: [] };
      const trick = { name: '兵粮寸断', source: attacker, card: trickCard };
      return applyAtoms(state, [
        { type: 'addPendingTrick', player: target, trick },
      ]);
    }

    case '无中生有': {
      return applyAtoms(state, [{ type: 'draw', player: attacker, count: 2 }]);
    }

    case '桃园结义': {
      const alivePlayers = state.playerOrder.filter(
        p => getPlayer(state, p).info.alive,
      );
      const healAtoms: Atom[] = alivePlayers.flatMap(p => {
        const ps = getPlayer(state, p);
        if (ps.health >= ps.maxHealth) return [];
        return [{ type: 'heal' as const, target: p, amount: 1, source: attacker }];
      });
      return applyAtoms(state, healAtoms);
    }

    case '五谷丰登': {
      const alivePlayerNames = state.playerOrder.filter(
        p => getPlayer(state, p).info.alive,
      );
      const count = Math.min(alivePlayerNames.length, state.zones.deck.length);
      if (count === 0) return { state, events: [] };

      const revealedCards = state.zones.deck.slice(0, count);
      const remainingDeck = state.zones.deck.slice(count);
      const startIdx = state.playerOrder.indexOf(state.currentPlayer);
      const pickOrder: string[] = [];
      for (let i = 0; i < state.playerOrder.length; i++) {
        const p = state.playerOrder[(startIdx - i + state.playerOrder.length) % state.playerOrder.length];
        if (getPlayer(state, p).info.alive) {
          pickOrder.push(p);
        }
      }
      const timeout = TIMEOUT_DEFAULTS.harvestSelection;
      const harvestPending: PendingHarvestSelection = {
        id: createPendingId(),
        type: 'harvestSelection',
        revealedCards,
        currentPickerIndex: 0,
        pickOrder,
        player: attacker,
        timeout,
        deadline: Date.now() + timeout,
        onTimeout: { type: 'respond', player: pickOrder[0], cardId: revealedCards[0] },
      };
      const s = { ...state, zones: { ...state.zones, deck: remainingDeck } };
      const result = applyAtoms(s, [{ type: 'pushPending', action: harvestPending }]);
      const harvestRevealEvent = makeServerEvent('harvestReveal', { cards: revealedCards });
      return { state: result.state, events: [...result.events, harvestRevealEvent] };
    }

    default:
      return { state, events: [] };
  }
}

function executeAoeResume(
  state: GameState,
  aoeResume: { attacker: string; remainingTargets: string[]; requiredCard: string; sourceCard: string },
): EngineResult {
  const { attacker, remainingTargets, requiredCard, sourceCard } = aoeResume;
  if (remainingTargets.length === 0) return { state, events: [] };

  const firstTarget = remainingTargets[0];
  const nextRemaining = remainingTargets.slice(1);
  const targetPlayer = getPlayer(state, firstTarget);
  const validCards = targetPlayer.hand.filter(
    id => state.cardMap[id]?.name === requiredCard,
  );
  const timeout = TIMEOUT_DEFAULTS.aoeResponse;

  const nextPending: PendingResponseWindow = {
    id: createPendingId(),
    type: 'responseWindow',
    window: {
      type: 'aoeResponse',
      attacker,
      defender: firstTarget,
      validCards,
      sourceCard,
      remainingTargets: nextRemaining,
      requiredCard,
      timeout,
      deadline: Date.now() + timeout,
    },
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: firstTarget },
  };

  return applyAtoms(state, [{ type: 'pushPending', action: nextPending }]);
}

/**
 * 为 AOE 的下一个目标开启无懈可击询问窗口。
 * remainingTargets[0] 是当前要处理的目标。
 */
export function startAoeTargetWuxie(
  state: GameState,
  params: {
    attacker: string;
    remainingTargets: string[];
    requiredCard: string;
    sourceCard: string;
  },
): EngineResult {
  const { attacker, remainingTargets, requiredCard, sourceCard } = params;

  // 过滤存活的目标
  const aliveTargets = remainingTargets.filter(t => getPlayer(state, t).info.alive);
  if (aliveTargets.length === 0) return { state, events: [] };

  // 所有存活玩家都可以出无懈可击（包括出牌者）
  const allAlive = getAlivePlayerNames(state);

  if (allAlive.length === 0) {
    // 无人可出无懈，直接创建 aoeResponse
    return executeAoeResume(state, { attacker, remainingTargets: aliveTargets, requiredCard, sourceCard });
  }

  const currentTarget = aliveTargets[0];

  // 创建无懈可击窗口，trickTarget 设为当前 AOE 目标
  const trickResponse = createConcurrentTrickResponse(state, {
    sourceCard,
    attacker,
    trickTarget: currentTarget,
    responders: allAlive,
    depth: 0,
    aoeResume: { attacker, remainingTargets: aliveTargets, requiredCard, sourceCard },
  });

  return applyAtoms(state, [{ type: 'pushPending', action: trickResponse }]);
}

function resolveLegacyTrickResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  const cardId = action.type === 'respond' ? action.cardId : undefined;
  const { attacker, defender, sourceCard, trickTarget, remainingPlayers, negated } = pending.window;
  if (!sourceCard) return { state, events: [], error: 'trickResponse 缺少 sourceCard' };
  if (!attacker) return { state, events: [], error: 'trickResponse 缺少 attacker' };
  const trickCard = state.cardMap[sourceCard];
  if (!trickCard) return { state, events: [], error: 'trickResponse 源卡牌不存在' };
  const trickName = trickCard.name;

  let newNegated = negated ?? false;

  if (cardId) {
    const card = state.cardMap[cardId];
    if (card?.name !== '无懈可击') {
      return { state, events: [], error: '只能用无懈可击响应锦囊' };
    }
    const responder = getPlayer(state, defender);
    if (!responder.hand.includes(cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }
    state = applyAtoms(state, [
      {
        type: 'moveCard',
        cardId,
        from: { zone: 'hand', player: defender },
        to: { zone: 'discardPile' },
      },
    ]).state;
    newNegated = !newNegated;
  }

  state = applyAtoms(state, [{ type: 'popPending' }]).state;

  if (remainingPlayers && remainingPlayers.length > 0) {
    const nextTarget = remainingPlayers[0];
    const nextRemaining = remainingPlayers.slice(1);
    const nextPlayer = getPlayer(state, nextTarget);
    const validWuxie = nextPlayer.hand.filter(id => state.cardMap[id]?.name === '无懈可击');
    const nextTimeout = TIMEOUT_DEFAULTS.trickResponse;

    const nextWindow: PendingResponseWindow = {
      id: createPendingId(),
      type: 'responseWindow',
      window: {
        type: 'trickResponse',
        attacker,
        defender: nextTarget,
        validCards: validWuxie,
        sourceCard,
        trickTarget: trickTarget ?? defender,
        remainingPlayers: nextRemaining,
        negated: newNegated,
        timeout: nextTimeout,
        deadline: Date.now() + nextTimeout,
      },
      timeout: nextTimeout,
      deadline: Date.now() + nextTimeout,
      onTimeout: { type: 'respond', player: nextTarget },
    };

    return applyAtoms(state, [{ type: 'pushPending', action: nextWindow }]);
  }

  if (pending.window.judgmentContext) {
    return resolveJudgmentTrickResponse(state, newNegated, trickName, pending.window.judgmentContext);
  }

  if (newNegated) return { state, events: [] };

  const target = trickTarget ?? defender;
  switch (trickName) {
    case '过河拆桥': {
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) return { state, events: [] };
      const selectPending: PendingSelectCard = {
        id: createPendingId(),
        type: 'selectCard',
        player: attacker,
        target,
        cardIds: targetPlayer.hand,
        min: 1,
        max: 1,
        sourceCard,
        mode: 'discard',
        timeout: TIMEOUT_DEFAULTS.selectCard,
        deadline: Date.now() + TIMEOUT_DEFAULTS.selectCard,
        onTimeout: { type: 'respond', player: attacker, cardIds: [targetPlayer.hand[0]] },
      };
      return applyAtoms(state, [{ type: 'pushPending', action: selectPending }]);
    }

    case '顺手牵羊': {
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) return { state, events: [] };
      const selectPending: PendingSelectCard = {
        id: createPendingId(),
        type: 'selectCard',
        player: attacker,
        target,
        cardIds: targetPlayer.hand,
        min: 1,
        max: 1,
        sourceCard,
        mode: 'steal',
        timeout: TIMEOUT_DEFAULTS.selectCard,
        deadline: Date.now() + TIMEOUT_DEFAULTS.selectCard,
        onTimeout: { type: 'respond', player: attacker, cardIds: [targetPlayer.hand[0]] },
      };
      return applyAtoms(state, [{ type: 'pushPending', action: selectPending }]);
    }

    case '决斗': {
      const validKills = getPlayer(state, target).hand.filter(
        id => state.cardMap[id]?.name === '杀',
      );
      const duelTimeout = TIMEOUT_DEFAULTS.killResponse;
      const duelWindow: PendingResponseWindow = {
        id: createPendingId(),
        type: 'responseWindow',
        window: {
          type: 'duelResponse',
          attacker,
          defender: target,
          validCards: validKills,
          sourceCard,
          timeout: duelTimeout,
          deadline: Date.now() + duelTimeout,
        },
        timeout: duelTimeout,
        deadline: Date.now() + duelTimeout,
        onTimeout: { type: 'respond', player: target },
      };
      return applyAtoms(state, [{ type: 'pushPending', action: duelWindow }]);
    }

    case '乐不思蜀': {
      const trick = { name: '乐不思蜀', source: attacker, card: trickCard };
      return applyAtoms(state, [
        { type: 'addPendingTrick', player: target, trick },
      ]);
    }

    case '兵粮寸断': {
      const trick = { name: '兵粮寸断', source: attacker, card: trickCard };
      return applyAtoms(state, [
        { type: 'addPendingTrick', player: target, trick },
      ]);
    }

    default:
      return { state, events: [] };
  }
}

function resolveJudgmentTrickResponse(
  state: GameState,
  negated: boolean,
  trickName: string,
  ctx: { player: string; trickIndex: number },
): EngineResult {
  const { player, trickIndex } = ctx;

  const atoms: Atom[] = [{ type: 'removePendingTrick', player, index: trickIndex }];

  if (!negated) {
    atoms.push({ type: 'judge', player, varKey: `judgeResult_${trickName}_${trickIndex}` });
  }

  const result = applyAtoms(state, atoms);
  let s = result.state;

  if (!negated) {
    const discardPile = s.zones.discardPile;
    const judgedCardId = discardPile[discardPile.length - 1];
    const suit = judgedCardId ? s.cardMap[judgedCardId]?.suit : '♣';

    let tag: string | undefined;
    if (trickName === '乐不思蜀' && suit !== '♥') {
      tag = 'skipPlay';
    } else if (trickName === '兵粮寸断' && suit !== '♣') {
      tag = 'skipDraw';
    }

    if (tag) {
      const tagResult = applyAtoms(s, [{ type: 'addTag', player, tag }]);
      s = tagResult.state;
      return { state: s, events: [...result.events, ...tagResult.events] };
    }
  }

  const nextIndex = trickIndex - 1;
  if (nextIndex < 0) {
    return { state: s, events: result.events };
  }

  const playerState = getPlayer(s, player);
  const nextTrick = playerState.pendingTricks[nextIndex];
  if (!nextTrick) {
    return { state: s, events: result.events };
  }

  const aliveOthers = getAlivePlayerNames(s).filter(p => p !== player);
  if (aliveOthers.length === 0) {
    return batchRemainJudgments(s, player, nextIndex);
  }

  const nextPending = createConcurrentTrickResponse(s, {
    sourceCard: nextTrick.card.id,
    attacker: nextTrick.source,
    trickTarget: player,
    responders: aliveOthers,
    depth: 0,
    judgmentContext: { player, trickIndex: nextIndex },
  });
  return applyAtoms(s, [{ type: 'pushPending', action: nextPending }]);
}

function batchRemainJudgments(
  state: GameState,
  player: string,
  fromIndex: number,
): EngineResult {
  const playerState = getPlayer(state, player);
  const tricks = playerState.pendingTricks;
  const atoms: Atom[] = [];
  const tags: string[] = [];

  for (let i = fromIndex; i >= 0; i--) {
    const trick = tricks[i];
    atoms.push({ type: 'judge', player, varKey: `judgeResult_${trick.name}_${i}` });
    atoms.push({ type: 'removePendingTrick', player, index: i });
  }

  const actionResult = applyAtoms(state, atoms);
  const s = actionResult.state;

  for (let i = fromIndex; i >= 0; i--) {
    const trick = tricks[i];
    const judgedCardId = s.zones.discardPile[s.zones.discardPile.length - 1 - i];
    const suit = judgedCardId ? s.cardMap[judgedCardId]?.suit : '♣';

    if (trick.name === '乐不思蜀' && suit !== '♥') {
      tags.push('skipPlay');
    } else if (trick.name === '兵粮寸断' && suit !== '♣') {
      tags.push('skipDraw');
    }
  }

  if (tags.length > 0) {
    const tagAtoms = tags.map(tag => ({ type: 'addTag' as const, player, tag }));
    const tagResult = applyAtoms(s, tagAtoms);
    return { state: tagResult.state, events: [...actionResult.events, ...tagResult.events] };
  }

  return { state: s, events: actionResult.events };
}

function resolveDuelResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  const { defender, attacker, sourceCard } = pending.window;
  if (!attacker || !sourceCard) {
    return { state, events: [], error: '决斗响应窗口缺少必要参数' };
  }

  const cardId = action.type === 'respond' ? action.cardId : undefined;

  if (cardId) {
    // 当前防守方出了杀 → 换对方继续出杀
    if (!isCardValidResponse(state, cardId, 'duelResponse', defender)) {
      return { state, events: [], error: '只能用杀（或可当杀使用的牌）响应决斗' };
    }
    const responder = getPlayer(state, defender);
    if (!responder.hand.includes(cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }

    // 弃杀，弹掉当前窗口
    const moveResult = applyAtoms(state, [
      {
        type: 'moveCard',
        cardId,
        from: { zone: 'hand', player: defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ]);

    // 轮到对方出杀：交换 attacker/defender
    const nextDefender = attacker;
    const nextAttacker = defender;
    const validKills = getPlayer(moveResult.state, nextDefender).hand.filter(
      id => moveResult.state.cardMap[id]?.name === '杀',
    );
    const duelTimeout = TIMEOUT_DEFAULTS.killResponse;
    const nextDuel: PendingResponseWindow = {
      id: createPendingId(),
      type: 'responseWindow',
      window: {
        type: 'duelResponse',
        attacker: nextAttacker,
        defender: nextDefender,
        validCards: validKills,
        sourceCard,
        timeout: duelTimeout,
        deadline: Date.now() + duelTimeout,
      },
      timeout: duelTimeout,
      deadline: Date.now() + duelTimeout,
      onTimeout: { type: 'respond', player: nextDefender },
    };
    const pushResult = applyAtoms(moveResult.state, [
      { type: 'pushPending', action: nextDuel },
    ]);
    return {
      state: pushResult.state,
      events: [...moveResult.events, ...pushResult.events],
    };
  }

  // 没出杀 → 当前防守方受 1 点伤害
  const { state: popState, events: popEvents } = applyAtoms(state, [{ type: 'popPending' }]);
  const damageResult = applyDamage(popState, defender, 1, attacker, sourceCard);

  return {
    state: damageResult.state,
    events: [...popEvents, ...damageResult.events],
  };
}

function resolveDyingResponse(
  state: GameState,
  _action: GameAction,
  _pending: PendingResponseWindow,
): EngineResult {
  const atoms: Atom[] = [{ type: 'popPending' }];
  const result = applyAtoms(state, atoms);
  return { state: result.state, events: result.events, error: '濒死响应不应通过此路径处理' };
}

export function resolveSelectCard(
  state: GameState,
  action: GameAction,
  pending: PendingSelectCard,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: '选牌需要 respond 动作' };
  }
  if (action.player !== pending.player) {
    return { state, events: [], error: '只有出牌者可以选择' };
  }

  const selectedIds = action.cardIds ?? (action.cardId ? [action.cardId] : []);
  if (selectedIds.length < pending.min || selectedIds.length > pending.max) {
    return { state, events: [], error: '选择的卡牌数量不符' };
  }

  // 校验所选卡牌确实在目标手中
  const targetPlayer = getPlayer(state, pending.target);
  for (const cardId of selectedIds) {
    if (!targetPlayer.hand.includes(cardId)) {
      return { state, events: [], error: '所选卡牌不在目标手牌中' };
    }
  }

  // 执行效果：steal 或 discard 目标的手牌
  // 注：源牌（锦囊牌）已在 handleTrickCard 中移入弃牌堆，此处不再重复移动
  const atoms: Atom[] = [];

  if (pending.mode === 'steal') {
    // 顺手牵羊：将目标牌移到出牌者手牌
    atoms.push(...selectedIds.map(cardId => ({
      type: 'moveCard' as const,
      cardId,
      from: { zone: 'hand' as const, player: pending.target },
      to: { zone: 'hand' as const, player: pending.player },
    })));
  } else {
    // 过河拆桥：将目标牌弃掉
    atoms.push(...selectedIds.map(cardId => ({
      type: 'moveCard' as const,
      cardId,
      from: { zone: 'hand' as const, player: pending.target },
      to: { zone: 'discardPile' as const },
    })));
  }

  atoms.push({ type: 'popPending' });
  const result = applyAtoms(state, atoms);
  return { state: result.state, events: result.events };
}
