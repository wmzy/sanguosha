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

  const { defender, attacker } = pending.window;

  if (action.cardId) {
    // 出了正确的牌 → 免疫
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
    return { state: result.state, events: result.events };
  }

  // 没出 → 受伤
  const damageAtoms: Atom[] = [
    { type: 'damage', target: defender, amount: 1, source: attacker },
    { type: 'popPending' },
  ];
  const { state: damagedState, events: damageEvents } = applyAtoms(state, damageAtoms);

  const defenderState = getPlayer(damagedState, defender);
  if (defenderState.health <= 0 && defenderState.info.alive) {
    const dyingPending = createDyingPending(damagedState, defender, attacker);
    const { state: dyingState, events: dyingEvents } = applyAtoms(damagedState, [
      { type: 'pushPending', action: dyingPending },
    ]);
    return { state: dyingState, events: [...damageEvents, ...dyingEvents] };
  }

  return { state: damagedState, events: damageEvents };
}

function resolveTrickResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  const cardId = action.type === 'respond' ? action.cardId : undefined;
  if (cardId) {
    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId,
        from: { zone: 'hand', player: pending.window.defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    return { state: result.state, events: result.events };
  }

  const atoms: Atom[] = [{ type: 'popPending' }];
  const result = applyAtoms(state, atoms);
  return { state: result.state, events: result.events };
}

function resolveDuelResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  const { defender, attacker } = pending.window;
  const cardId = action.type === 'respond' ? action.cardId : undefined;

  if (cardId) {
    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId,
        from: { zone: 'hand', player: defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    return { state: result.state, events: result.events };
  }

  // 没出杀 → 受伤
  const atoms: Atom[] = [
    { type: 'damage', target: defender, amount: 1, source: attacker },
    { type: 'popPending' },
  ];
  const result = applyAtoms(state, atoms);
  return { state: result.state, events: result.events };
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

  // 弃掉源牌
  const atoms: Atom[] = [
    {
      type: 'moveCard',
      cardId: pending.sourceCard,
      from: { zone: 'hand', player: pending.player },
      to: { zone: 'discardPile' },
    },
  ];

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
