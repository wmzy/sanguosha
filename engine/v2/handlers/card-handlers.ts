import type {
  GameState,
  GameAction,
  EngineResult,
  Atom,
  PendingResponseWindow,
  PendingSelectCard,
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
    { type: 'incrementKills' },
  ];
  const result = applyAtoms(state, atoms);

  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
    target,
  });
  return { state: result.state, events: [...result.events, cardPlayedEvent] };
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
      const result = applyAtoms(state, [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
        { type: 'draw', player, count: 2 },
      ]);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    // ── 可被无懈可击的锦囊：先弃源牌，开 trickResponse ──
    case '过河拆桥':
    case '顺手牵羊':
    case '决斗':
    case '乐不思蜀':
    case '兵粮寸断': {
      const target = action.target;
      if (!target) return { state, events: [], error: `${card.name}需要指定目标` };

      // 校验目标存活
      const targetPlayer = getPlayer(state, target);
      if (!targetPlayer.info.alive) return { state, events: [], error: '目标已阵亡' };

      // 顺手牵羊距离检查
      if (card.name === '顺手牵羊' && getDistance(state, player, target) !== 1) {
        return { state, events: [], error: '顺手牵羊目标距离必须为 1' };
      }

      // 过河拆桥/顺手牵羊需要目标有手牌
      if ((card.name === '过河拆桥' || card.name === '顺手牵羊') && targetPlayer.hand.length === 0) {
        return { state, events: [], error: '目标没有手牌' };
      }

      // 1. 弃掉源牌
      const moveAtom: Atom = {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player },
        to: { zone: 'discardPile' },
      };

      // 2. 开 trickResponse 窗口（所有存活玩家依次出无懈可击）
      const attackerIndex = state.playerOrder.indexOf(player);
      const afterAttacker = state.playerOrder.slice(attackerIndex + 1).filter(
        p => getPlayer(state, p).info.alive,
      );
      const beforeAttacker = state.playerOrder.slice(0, attackerIndex).filter(
        p => getPlayer(state, p).info.alive,
      );
      const allPlayers = [...afterAttacker, ...beforeAttacker];

      if (allPlayers.length === 0) {
        // 没有其他存活玩家，跳过无懈流程直接放行
        const trickResult = applyAtoms(state, [moveAtom]);
        return { state: trickResult.state, events: [...trickResult.events, cardPlayedEvent] };
      }

      const firstTarget = allPlayers[0];
      const remaining = allPlayers.slice(1);
      const firstPlayerState = getPlayer(state, firstTarget);
      const validWuxie = firstPlayerState.hand.filter(id => state.cardMap[id]?.name === '无懈可击');
      const timeout = TIMEOUT_DEFAULTS.trickResponse;
      const trickResponse: PendingResponseWindow = {
        type: 'responseWindow',
        window: {
          type: 'trickResponse',
          attacker: player,
          defender: firstTarget,
          validCards: validWuxie,
          sourceCard: action.cardId,
          trickTarget: target,
          remainingPlayers: remaining,
          negated: false,
          timeout,
          deadline: Date.now() + timeout,
        },
        timeout,
        deadline: Date.now() + timeout,
        onTimeout: { type: 'respond', player: firstTarget },
      };

      const result = applyAtoms(state, [moveAtom, { type: 'pushPending', action: trickResponse }]);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    // ── AOE：每个其他玩家依次响应（南蛮入侵→出杀，万箭齐发→出闪） ──
    case '南蛮入侵':
    case '万箭齐发': {
      const requiredCard = card.name === '南蛮入侵' ? '杀' : '闪';

      // 按 playerOrder 依次响应
      const affected = state.playerOrder.filter(
        p => p !== player && getPlayer(state, p).info.alive,
      );

      // 只创建第一个 aoeResponse，后续通过 resolveAoeResponse 链式创建
      const firstTarget = affected[0];
      if (!firstTarget) {
        // 没有其他存活玩家，只弃牌
        const result = applyAtoms(state, [
          { type: 'moveCard', cardId: action.cardId, from: { zone: 'hand', player }, to: { zone: 'discardPile' } },
        ]);
        return { state: result.state, events: [...result.events, cardPlayedEvent] };
      }

      const remaining = affected.slice(1);
      const firstPlayer = getPlayer(state, firstTarget);
      const validCards = firstPlayer.hand.filter(
        id => state.cardMap[id]?.name === requiredCard,
      );
      const timeout = TIMEOUT_DEFAULTS.aoeResponse;

      const responseWindow = {
        type: 'responseWindow' as const,
        window: {
          type: 'aoeResponse' as const,
          attacker: player,
          defender: firstTarget,
          validCards,
          sourceCard: action.cardId,
          remainingTargets: remaining,
          requiredCard,
          timeout,
          deadline: Date.now() + timeout,
        },
        timeout,
        deadline: Date.now() + timeout,
        onTimeout: { type: 'respond' as const, player: firstTarget },
      };

      const atoms: Atom[] = [
        { type: 'moveCard', cardId: action.cardId, from: { zone: 'hand', player }, to: { zone: 'discardPile' } },
        { type: 'pushPending', action: responseWindow },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    // ── 其他锦囊（桃园结义、五谷丰登、无懈可击等） ──
    default: {
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
