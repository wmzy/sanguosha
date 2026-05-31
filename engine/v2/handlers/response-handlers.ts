import type {
  GameState,
  GameAction,
  EngineResult,
  Atom,
  PendingResponseWindow,
  PendingSelectCard,
  GameEvent,
  ServerEvent,
} from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { getPlayer } from '../state';
import { makeServerEvent } from '../event';
import { applyAtoms, createDyingPending } from './engine-utils';
import { emitEvent } from '../skill';

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
    const card = state.cardMap[action.cardId];
    if (card.name !== '闪') {
      return { state, events: [], error: '只能用闪响应杀' };
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

  // ── 不出 → 受到伤害 ──
  let damageAmount = 1;
  if (attacker) {
    const attackerState = getPlayer(state, attacker);
    if (attackerState.vars['裸衣/active'] === true) {
      damageAmount = 2;
    }
  }

  const damageAtoms: Atom[] = [
    {
      type: 'damage',
      target: defender,
      amount: damageAmount,
      source: attacker,
      cardId: pending.window.sourceCard,
    },
    { type: 'popPending' },
  ];
  const { state: damagedState, events: damageEvents } = applyAtoms(state, damageAtoms);
  const hitEvent = makeServerEvent('killHit', {
    attacker: attacker ?? '',
    defender,
  });

  // 触发 damageDealt 事件，使依赖伤害的技能可以响应（反馈、遗计、刚烈等）
  let s = damagedState;
  let skillEvents: ServerEvent[] = [];
  if (attacker) {
    const damageEvent: GameEvent = {
      type: 'damageDealt' as const,
      source: attacker,
      target: defender,
      amount: damageAmount,
      cardId: pending.window.sourceCard,
    };
    const skillResult = emitEvent(s, damageEvent);
    s = skillResult.state;
    skillEvents = skillResult.events;

    // 如果技能产生了 pending（如刚烈的判定），先返回等待处理
    // 同时设置延迟濒死检查，确保 pending 解决后不遗漏濒死判定
    if (s.pending !== null) {
      const defenderState = getPlayer(s, defender);
      if (defenderState.health <= 0 && defenderState.info.alive) {
        s = { ...s, deferredDyingCheck: { player: defender, source: attacker } };
      }
      return { state: s, events: [...damageEvents, hitEvent, ...skillEvents] };
    }
  }

  // 检查濒死
  const defenderState = getPlayer(s, defender);
  if (defenderState.health <= 0 && defenderState.info.alive) {
    const dyingPending = createDyingPending(s, defender, attacker);
    const { state: dyingState, events: dyingEvents } = applyAtoms(s, [
      { type: 'pushPending', action: dyingPending },
    ]);
    const dyingEvent = makeServerEvent('dying', {
      player: defender,
      ...(attacker ? { source: attacker } : {}),
    });
    return {
      state: dyingState,
      events: [...damageEvents, hitEvent, ...skillEvents, ...dyingEvents, dyingEvent],
    };
  }

  return { state: s, events: [...damageEvents, hitEvent, ...skillEvents] };
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
  let currentState = state;
  let currentEvents: ServerEvent[] = [];

  if (action.cardId) {
    // 出了正确的牌 → 免疫
    const atoms: Atom[] = [
      { type: 'moveCard', cardId: action.cardId, from: { zone: 'hand', player: defender }, to: { zone: 'discardPile' } },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    currentState = result.state;
    currentEvents = result.events;
  } else {
    // 没出 → 受伤
    const damageAtoms: Atom[] = [
      { type: 'damage', target: defender, amount: 1, source: attacker },
      { type: 'popPending' },
    ];
    const result = applyAtoms(currentState, damageAtoms);
    currentState = result.state;
    currentEvents = result.events;
  }

  // 检查濒死
  const defState = getPlayer(currentState, defender);
  if (defState.health <= 0 && defState.info.alive) {
    const dyingPending = createDyingPending(currentState, defender, attacker);
    const resumeAoe = remainingTargets && remainingTargets.length > 0 && attacker && requiredCard && sourceCard
      ? { attacker, remainingTargets, requiredCard, sourceCard }
      : undefined;
    const dyingWithResume = { ...dyingPending, resumeAoe };
    const { state: dyingState, events: dyingEvents } = applyAtoms(currentState, [
      { type: 'pushPending', action: dyingWithResume },
    ]);
    return { state: dyingState, events: [...currentEvents, ...dyingEvents] };
  }

  // 还有剩余玩家需要响应 → 创建下一个 aoeResponse
  if (remainingTargets && remainingTargets.length > 0 && attacker && requiredCard && sourceCard) {
    const nextTarget = remainingTargets[0];
    const nextRemaining = remainingTargets.slice(1);
    const targetPlayer = getPlayer(currentState, nextTarget);
    const validCards = targetPlayer.hand.filter(
      id => currentState.cardMap[id]?.name === requiredCard,
    );
    const timeout = TIMEOUT_DEFAULTS.aoeResponse;
    const nextPending: PendingResponseWindow = {
      type: 'responseWindow',
      window: {
        type: 'aoeResponse',
        attacker,
        defender: nextTarget,
        validCards,
        sourceCard,
        remainingTargets: nextRemaining,
        requiredCard,
        timeout,
        deadline: Date.now() + timeout,
      },
      timeout,
      deadline: Date.now() + timeout,
      onTimeout: { type: 'respond', player: nextTarget },
    };
    const { state: pushState, events: pushEvents } = applyAtoms(currentState, [
      { type: 'pushPending', action: nextPending },
    ]);
    return { state: pushState, events: [...currentEvents, ...pushEvents] };
  }

  return { state: currentState, events: currentEvents };
}

function resolveTrickResponse(
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
    // 出了无懈可击 → 翻转取消状态
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

  // Pop current pending
  state = applyAtoms(state, [{ type: 'popPending' }]).state;

  // 还有剩余玩家 → 链式询问下一个
  if (remainingPlayers && remainingPlayers.length > 0) {
    const nextTarget = remainingPlayers[0];
    const nextRemaining = remainingPlayers.slice(1);
    const nextPlayer = getPlayer(state, nextTarget);
    const validWuxie = nextPlayer.hand.filter(id => state.cardMap[id]?.name === '无懈可击');
    const nextTimeout = TIMEOUT_DEFAULTS.trickResponse;

    const nextWindow: PendingResponseWindow = {
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

  // 所有玩家都问完了
  if (newNegated) {
    // 被无懈取消，直接返回
    return { state, events: [] };
  }

  // 无无懈 → 放行，执行锦囊效果
  const target = trickTarget ?? defender;
  switch (trickName) {
    case '过河拆桥': {
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) {
        return { state, events: [] };
      }
      const selectPending: PendingSelectCard = {
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
      if (targetPlayer.hand.length === 0) {
        return { state, events: [] };
      }
      const selectPending: PendingSelectCard = {
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
    const card = state.cardMap[cardId];
    if (card?.name !== '杀') {
      return { state, events: [], error: '只能用杀响应决斗' };
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
  const damageAtoms: Atom[] = [
    { type: 'damage', target: defender, amount: 1, source: attacker },
    { type: 'popPending' },
  ];
  const result = applyAtoms(state, damageAtoms);

  // 检查濒死
  const defenderState = getPlayer(result.state, defender);
  if (defenderState.health <= 0 && defenderState.info.alive) {
    const dyingPending = createDyingPending(result.state, defender, attacker);
    const { state: dyingState, events: dyingEvents } = applyAtoms(result.state, [
      { type: 'pushPending', action: dyingPending },
    ]);
    return {
      state: dyingState,
      events: [...result.events, ...dyingEvents],
    };
  }

  return result;
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
