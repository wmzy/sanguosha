import type {
  GameState,
  GameAction,
  EngineResult,
  Atom,
  PendingResponseWindow,
} from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import type { Card } from '../../../shared/types';
import type { GameEvent } from '../types';
import { getPlayer } from '../state';
import { getDistance, isInAttackRange } from '../distance';
import { makeServerEvent } from '../event';
import { applyAtoms } from './engine-utils';
import { emitEvent } from '../skill';

export function handlePlayCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
): EngineResult {
  const card = state.cardMap[action.cardId];
  if (!card) return { state, events: [], error: '未知卡牌' };

  let result: EngineResult;
  switch (card.type) {
    case '基本牌':
      result = handleBasicCard(state, action, card);
      break;
    case '锦囊牌':
      result = handleTrickCard(state, action, card);
      break;
    case '装备牌':
      result = handleEquipCard(state, action, card);
      break;
  }
  if (!result || result.error) return result;

  // 触发 cardPlayed 事件，使依赖此事件的技能可以响应
  const gameEvent: GameEvent = {
    type: 'cardPlayed',
    player: action.player,
    cardId: action.cardId,
    ...(action.target ? { target: action.target } : {}),
  };
  const skillResult = emitEvent(result.state, gameEvent);
  return {
    state: skillResult.state,
    events: [...result.events, ...skillResult.events],
  };
}

function handleBasicCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  card: Card,
): EngineResult {
  switch (card.name) {
    case '杀':
      return handleKillCard(state, action, card);
    case '桃':
      return handlePeachCard(state, action, card);
    case '闪':
      return { state, events: [], error: '闪不能主动使用' };
    default:
      return { state, events: [], error: `不能主动使用 ${card.name}` };
  }
}

function handleKillCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  _card: Card,
): EngineResult {
  const player = action.player;
  const target = action.target;

  if (!target) return { state, events: [], error: '杀需要指定目标' };
  if (target === player) return { state, events: [], error: '不能对自己使用杀' };
  if (!isInAttackRange(state, player, target)) {
    return { state, events: [], error: '目标不在攻击范围内' };
  }

  const targetPlayer = getPlayer(state, target);
  if (!targetPlayer.info.alive) return { state, events: [], error: '目标已阵亡' };

  // 计算目标可用闪
  const validCards = targetPlayer.hand.filter(
    (id) => state.cardMap[id].name === '闪',
  );

  const timeout = TIMEOUT_DEFAULTS.killResponse;
  const responseWindow: PendingResponseWindow = {
    type: 'responseWindow',
    window: {
      type: 'killResponse',
      attacker: player,
      defender: target,
      validCards,
      sourceCard: action.cardId,
      timeout,
      deadline: Date.now() + timeout,
    },
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: target },
  };

  const atoms: Atom[] = [
    {
      type: 'moveCard',
      cardId: action.cardId,
      from: { zone: 'hand', player },
      to: { zone: 'discardPile' },
    },
    { type: 'pushPending', action: responseWindow },
  ];
  const result = applyAtoms(state, atoms);

  // 更新回合杀计数
  const newState: GameState = {
    ...result.state,
    turn: {
      ...result.state.turn,
      killsPlayed: result.state.turn.killsPlayed + 1,
    },
  };

  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
    target,
  });
  return { state: newState, events: [...result.events, cardPlayedEvent] };
}

function handlePeachCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  _card: Card,
): EngineResult {
  const player = action.player;
  const playerState = getPlayer(state, player);

  if (playerState.health >= playerState.maxHealth) {
    return { state, events: [], error: '体力已满，不能使用桃' };
  }

  const atoms: Atom[] = [
    {
      type: 'moveCard',
      cardId: action.cardId,
      from: { zone: 'hand', player },
      to: { zone: 'discardPile' },
    },
    { type: 'heal', target: player, amount: 1, source: player },
  ];
  const result = applyAtoms(state, atoms);
  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
  });
  return { state: result.state, events: [...result.events, cardPlayedEvent] };
}

function handleTrickCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  card: Card,
): EngineResult {
  const player = action.player;
  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
    ...(action.target ? { target: action.target } : {}),
  });

  switch (card.name) {
    case '无中生有': {
      const atoms: Atom[] = [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
        { type: 'draw', player, count: 2 },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    case '过河拆桥': {
      const target = action.target;
      if (!target) return { state, events: [], error: '过河拆桥需要指定目标' };
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) {
        return { state, events: [], error: '目标没有手牌' };
      }
      // 简化：弃第一张
      const discardCardId = targetPlayer.hand[0];
      const atoms: Atom[] = [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
        {
          type: 'moveCard',
          cardId: discardCardId,
          from: { zone: 'hand', player: target },
          to: { zone: 'discardPile' },
        },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    case '顺手牵羊': {
      const target = action.target;
      if (!target) return { state, events: [], error: '顺手牵羊需要指定目标' };
      if (getDistance(state, player, target) !== 1) {
        return { state, events: [], error: '顺手牵羊目标距离必须为 1' };
      }
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) {
        return { state, events: [], error: '目标没有手牌' };
      }
      const stolenCardId = targetPlayer.hand[0];
      const atoms: Atom[] = [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
        {
          type: 'moveCard',
          cardId: stolenCardId,
          from: { zone: 'hand', player: target },
          to: { zone: 'hand', player },
        },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    default: {
      // 其他锦囊牌（简化处理：弃掉使用的牌）
      const atoms: Atom[] = [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }
  }
}

function handleEquipCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  _card: Card,
): EngineResult {
  const player = action.player;
  const atoms: Atom[] = [{ type: 'equip', player, cardId: action.cardId }];
  const result = applyAtoms(state, atoms);
  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
  });
  return { state: result.state, events: [...result.events, cardPlayedEvent] };
}
