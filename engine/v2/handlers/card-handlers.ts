import type {
  GameState,
  GameAction,
  EngineResult,
  Atom,
  PendingResponseWindow,
  PendingHarvestSelection,
} from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import type { Card } from '../../../shared/types';
import type { GameEvent } from '../types';
import { getPlayer } from '../state';
import { getDistance, isInAttackRange } from '../distance';
import { makeServerEvent } from '../event';
import { applyAtoms } from './engine-utils';
import { emitEvent } from '../skill';
import { createConcurrentTrickResponse, startAoeTargetWuxie } from './response-handlers';
import { getSkillConvertedCards } from '../validate';

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

  const literalDodge = targetPlayer.hand.filter(
    (id) => state.cardMap[id].name === '闪',
  );
  const skillDodge = getSkillConvertedCards(state, target, '闪');
  const validCards = [...new Set([...literalDodge, ...skillDodge])];

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
    // ── 无目标可被无懈的锦囊：先弃源牌，开 trickResponse ──
    case '无中生有': {
      const moveAtom: Atom = {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player },
        to: { zone: 'discardPile' },
      };

      const attackerIndex = state.playerOrder.indexOf(player);
      const afterAttacker = state.playerOrder.slice(attackerIndex + 1).filter(
        p => getPlayer(state, p).info.alive,
      );
      const beforeAttacker = state.playerOrder.slice(0, attackerIndex).filter(
        p => getPlayer(state, p).info.alive,
      );
      const allPlayers = [...afterAttacker, ...beforeAttacker];

      if (allPlayers.length === 0) {
        const trickResult = applyAtoms(state, [moveAtom]);
        return { state: trickResult.state, events: [...trickResult.events, cardPlayedEvent] };
      }

      const trickResponse = createConcurrentTrickResponse(state, {
        sourceCard: action.cardId,
        attacker: player,
        responders: allPlayers,
        depth: 0,
      });

      const result = applyAtoms(state, [moveAtom, { type: 'pushPending', action: trickResponse }]);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    // ── 桃园结义：所有存活玩家各回 1 点体力 ──
    case '桃园结义': {
      const alivePlayers = state.playerOrder.filter(
        p => getPlayer(state, p).info.alive,
      );
      const healAtoms: Atom[] = alivePlayers.flatMap(p => {
        const ps = getPlayer(state, p);
        if (ps.health >= ps.maxHealth) return [];
        return [{ type: 'heal' as const, target: p, amount: 1, source: player }];
      });
      const result = applyAtoms(state, [
        { type: 'moveCard', cardId: action.cardId, from: { zone: 'hand', player }, to: { zone: 'discardPile' } },
        ...healAtoms,
      ]);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    // ── 五谷丰登：翻出 N 张牌（N=存活玩家数），存活玩家逆时针依次选一张 ──
    case '五谷丰登': {
      const alivePlayerNames = state.playerOrder.filter(
        p => getPlayer(state, p).info.alive,
      );
      const count = Math.min(alivePlayerNames.length, state.zones.deck.length);
      if (count === 0) {
        const result = applyAtoms(state, [
          { type: 'moveCard', cardId: action.cardId, from: { zone: 'hand', player }, to: { zone: 'discardPile' } },
        ]);
        return { state: result.state, events: [...result.events, cardPlayedEvent] };
      }

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
        type: 'harvestSelection',
        revealedCards,
        currentPickerIndex: 0,
        pickOrder,
        player,
        timeout,
        deadline: Date.now() + timeout,
        onTimeout: { type: 'respond', player: pickOrder[0], cardId: revealedCards[0] },
      };

      const result = applyAtoms(
        { ...state, zones: { ...state.zones, deck: remainingDeck } },
        [
          { type: 'moveCard', cardId: action.cardId, from: { zone: 'hand', player }, to: { zone: 'discardPile' } },
          { type: 'pushPending', action: harvestPending },
        ],
      );
      const harvestRevealEvent = makeServerEvent('harvestReveal', { cards: revealedCards });
      return { state: result.state, events: [...result.events, cardPlayedEvent, harvestRevealEvent] };
    }

    // ── 可被无懈可击的锦囊（有目标）：先弃源牌，开 trickResponse ──
    case '过河拆桥':
    case '顺手牵羊':
    case '决斗': {
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

      // 2. 开 trickResponse 窗口（抢占式并发：所有存活玩家同时可出无懈可击）
      const attackerIndex = state.playerOrder.indexOf(player);
      const afterAttacker = state.playerOrder.slice(attackerIndex + 1).filter(
        p => getPlayer(state, p).info.alive,
      );
      const beforeAttacker = state.playerOrder.slice(0, attackerIndex).filter(
        p => getPlayer(state, p).info.alive,
      );
      const allPlayers = [...afterAttacker, ...beforeAttacker];

      if (allPlayers.length === 0) {
        const trickResult = applyAtoms(state, [moveAtom]);
        return { state: trickResult.state, events: [...trickResult.events, cardPlayedEvent] };
      }

      const trickResponse = createConcurrentTrickResponse(state, {
        sourceCard: action.cardId,
        attacker: player,
        trickTarget: target,
        responders: allPlayers,
        depth: 0,
      });

      const result = applyAtoms(state, [moveAtom, { type: 'pushPending', action: trickResponse }]);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    // ── 延迟锦囊：出牌时不问无懈可击，直接放入判定区 ──
    // 无懈可击在判定阶段执行判定前询问
    case '乐不思蜀':
    case '兵粮寸断': {
      const target = action.target;
      if (!target) return { state, events: [], error: `${card.name}需要指定目标` };

      const targetPlayer = getPlayer(state, target);
      if (!targetPlayer.info.alive) return { state, events: [], error: '目标已阵亡' };

      const trick = { name: card.name, source: player, card };
      const result = applyAtoms(state, [
        { type: 'moveCard', cardId: action.cardId, from: { zone: 'hand', player }, to: { zone: 'discardPile' } },
        { type: 'addPendingTrick', player: target, trick },
      ]);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    // ── AOE：先问无懈可击，再每个其他玩家依次响应（南蛮入侵→出杀，万箭齐发→出闪） ──
    case '南蛮入侵':
    case '万箭齐发': {
      const requiredCard = card.name === '南蛮入侵' ? '杀' : '闪';

      const affected = state.playerOrder.filter(
        p => p !== player && getPlayer(state, p).info.alive,
      );

      const moveAtom: Atom = {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player },
        to: { zone: 'discardPile' },
      };

      if (affected.length === 0) {
        const result = applyAtoms(state, [moveAtom]);
        return { state: result.state, events: [...result.events, cardPlayedEvent] };
      }

      const { state: movedState, events: moveEvents } = applyAtoms(state, [moveAtom]);
      const wuxieResult = startAoeTargetWuxie(movedState, {
        attacker: player,
        remainingTargets: affected,
        requiredCard,
        sourceCard: action.cardId,
      });

      return {
        state: wuxieResult.state,
        events: [...moveEvents, ...wuxieResult.events, cardPlayedEvent],
      };
    }

    // ── 其他锦囊（无懈可击等） ──
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

// ── 五谷丰登选牌处理 ──────────────────────────────────────

export function resolveHarvestSelection(
  state: GameState,
  action: GameAction,
  pending: PendingHarvestSelection,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: '选牌需要 respond 动作' };
  }

  const currentPicker = pending.pickOrder[pending.currentPickerIndex];
  if (action.player !== currentPicker) {
    return { state, events: [], error: '还没轮到你选牌' };
  }

  const selectedId = action.cardId ?? pending.revealedCards[0];
  let newRevealed = pending.revealedCards;

  if (!newRevealed.includes(selectedId)) {
    return { state, events: [], error: '选择的卡牌不在翻出的牌中' };
  }
  newRevealed = newRevealed.filter(id => id !== selectedId);

  const nextIndex = pending.currentPickerIndex + 1;

  if (nextIndex >= pending.pickOrder.length) {
    // 所有人都选完了，剩余牌进弃牌堆
    const atoms: Atom[] = [
      { type: 'popPending' },
      ...newRevealed.map(id => ({
        type: 'moveCard' as const,
        cardId: id,
        from: { zone: 'deck' as const },
        to: { zone: 'discardPile' as const },
      })),
    ];
    if (selectedId) {
      atoms.unshift({
        type: 'moveCard',
        cardId: selectedId,
        from: { zone: 'deck' },
        to: { zone: 'hand', player: action.player },
      });
    }
    const result = applyAtoms(state, atoms);
    const harvestDoneEvent = makeServerEvent('harvestDone', {
      player: action.player,
      cardId: selectedId ?? null,
    });
    return { state: result.state, events: [...result.events, harvestDoneEvent] };
  }

  // 还有下一位选牌者
  const nextPicker = pending.pickOrder[nextIndex];
  const atoms: Atom[] = [];
  if (selectedId) {
    atoms.push({
      type: 'moveCard',
      cardId: selectedId,
      from: { zone: 'deck' },
      to: { zone: 'hand', player: action.player },
    });
  }
  const timeout = TIMEOUT_DEFAULTS.harvestSelection;
  const nextPending: PendingHarvestSelection = {
    ...pending,
    revealedCards: newRevealed,
    currentPickerIndex: nextIndex,
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: nextPicker, cardId: newRevealed[0] },
  };
  atoms.push({ type: 'pushPending', action: nextPending });

  // 如果在同一个调用中既有 moveCard 又有 pushPending，先 pop 再 push
  const popThenPush = [{ type: 'popPending' as const }, ...atoms];
  const result = applyAtoms(state, popThenPush);
  return { state: result.state, events: result.events };
}
