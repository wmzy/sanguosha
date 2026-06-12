// @ts-nocheck
import type {
  GameState,
  GameAction,
  EngineResult,
  Atom,
  PendingResponseWindow,
  PendingHarvestSelection,
  EquipSlot,
} from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import type { Card } from '../../shared/types';
import { getPlayer } from '../state';
import { getDistance, isInAttackRange } from '../distance';
import { hasSkill } from '../mark';
import { makeLogEntry } from '../event';
import { applyAtoms } from '../atom';
import { createPendingId } from '../atoms/pending';
import { getSkill } from '../skill';
import { createConcurrentTrickResponse, startAoeTargetWuxie } from './response-handlers';
import { getSkillConvertedCards } from '../validate';

export function handlePlayCard(
  state: GameState,
  action: GameAction & { type: '打出一张牌' },
): EngineResult {
  const card = state.cardMap[action.cardId];
  if (!card) return { state, logEntries: [], error: '未知卡牌' };

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

  // [P5-T3] 阶段 D 准备：'出牌' 事件改用 applyAtoms 派发，ATOM_GAME_EVENTS 在
  // applyAtoms 内部自动 emitEvent 触发 v2 派发管道，消除手工 emitEvent。
  const emitResult = applyAtoms(result.state, [
    {
      type: '出牌',
      player: action.player,
      cardId: action.cardId,
      ...(action.target ? { target: action.target } : {}),
    },
  ]);
  return {
    state: emitResult.state,
    logEntries: [...result.logEntries, ...emitResult.logEntries],
  };
}

function handleBasicCard(
  state: GameState,
  action: GameAction & { type: '打出一张牌' },
  card: Card,
): EngineResult {
  switch (card.name) {
    case '杀':
      return handleKillCard(state, action, card);
    case '桃':
      return handlePeachCard(state, action, card);
    case '闪':
      return { state, logEntries: [], error: '闪不能主动使用' };
    default:
      return { state, logEntries: [], error: `不能主动使用 ${card.name}` };
  }
}

function handleKillCard(
  state: GameState,
  action: GameAction & { type: '打出一张牌' },
  _card: Card,
): EngineResult {
  const player = action.player;
  const target = action.target;

  if (!target) return { state, logEntries: [], error: '杀需要指定目标' };
  if (target === player) return { state, logEntries: [], error: '不能对自己使用杀' };
  if (!isInAttackRange(state, player, target)) {
    return { state, logEntries: [], error: '目标不在攻击范围内' };
  }

  const targetPlayer = getPlayer(state, target);
  if (!targetPlayer.info.alive) return { state, logEntries: [], error: '目标已阵亡' };

  const literalDodge = targetPlayer.hand.filter(
    (id) => state.cardMap[id].name === '闪',
  );
  const skillDodge = getSkillConvertedCards(state, target, '闪');
  const validCards = [...new Set([...literalDodge, ...skillDodge])];

  // 无双（吕布）：杀需 2 闪抵消
  const hasWushuang = hasSkill(state, player, '无双');

  const timeout = TIMEOUT_DEFAULTS.killResponse;
  const responseWindow: PendingResponseWindow = {
    id: createPendingId(),
    type: '响应窗口',
    window: {
      type: 'killResponse',
      attacker: player,
      defender: target,
      validCards,
      sourceCard: action.cardId,
      requiredFlashCount: hasWushuang ? 2 : undefined,
      timeout,
      deadline: Date.now() + timeout,
    },
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: '打出', player: target },
  };

  const atoms: Atom[] = [
    {
      type: '移动牌',
      cardId: action.cardId,
      from: { zone: '手牌', player },
      to: { zone: '弃牌堆' },
    },
    { type: '推入待定', action: responseWindow },
    { type: '累计出杀' },
  ];
  const result = applyAtoms(state, atoms);

  const cardPlayedLogEntry = makeLogEntry({ type: '出牌', player, cardId: action.cardId, target } as unknown as Atom);
  return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
}

function handlePeachCard(
  state: GameState,
  action: GameAction & { type: '打出一张牌' },
  _card: Card,
): EngineResult {
  const player = action.player;
  const playerState = getPlayer(state, player);

  if (playerState.health >= playerState.maxHealth) {
    return { state, logEntries: [], error: '体力已满，不能使用桃' };
  }

  const atoms: Atom[] = [
    {
      type: '移动牌',
      cardId: action.cardId,
      from: { zone: '手牌', player },
      to: { zone: '弃牌堆' },
    },
    { type: '回复体力', target: player, amount: 1, source: player },
  ];
  const result = applyAtoms(state, atoms);
  const cardPlayedLogEntry = makeLogEntry({ type: '出牌', player, cardId: action.cardId } as unknown as Atom);
  return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
}

function handleTrickCard(
  state: GameState,
  action: GameAction & { type: '打出一张牌' },
  card: Card,
): EngineResult {
  const player = action.player;
  const cardPlayedLogEntry = makeLogEntry({ type: '出牌', player, cardId: action.cardId, ...(action.target ? { target: action.target } : {}) } as unknown as Atom);

  switch (card.name) {
    // ── 无目标可被无懈的锦囊：先弃源牌，开 trickResponse ──
    case '无中生有': {
      const moveAtom: Atom = {
        type: '移动牌',
        cardId: action.cardId,
        from: { zone: '手牌', player },
        to: { zone: '弃牌堆' },
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
        return { state: trickResult.state, logEntries: [...trickResult.logEntries, cardPlayedLogEntry] };
      }

      const trickResponse = createConcurrentTrickResponse(state, {
        sourceCard: action.cardId,
        attacker: player,
        responders: allPlayers,
        depth: 0,
      });

      const result = applyAtoms(state, [moveAtom, { type: '推入待定', action: trickResponse }]);
      return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
    }

    // ── 桃园结义：所有存活玩家各回 1 点体力 ──
    case '桃园结义': {
      const alivePlayers = state.playerOrder.filter(
        p => getPlayer(state, p).info.alive,
      );
      const healAtoms: Atom[] = alivePlayers.flatMap(p => {
        const ps = getPlayer(state, p);
        if (ps.health >= ps.maxHealth) return [];
        return [{ type: '回复体力' as const, target: p, amount: 1, source: player }];
      });
      const result = applyAtoms(state, [
        { type: '移动牌', cardId: action.cardId, from: { zone: '手牌', player }, to: { zone: '弃牌堆' } },
        ...healAtoms,
      ]);
      return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
    }

    // ── 五谷丰登：翻出 N 张牌（N=存活玩家数），存活玩家逆时针依次选一张 ──
    case '五谷丰登': {
      const alivePlayerNames = state.playerOrder.filter(
        p => getPlayer(state, p).info.alive,
      );
      const count = Math.min(alivePlayerNames.length, state.zones.deck.length);
      if (count === 0) {
        const result = applyAtoms(state, [
          { type: '移动牌', cardId: action.cardId, from: { zone: '手牌', player }, to: { zone: '弃牌堆' } },
        ]);
        return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
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
        id: createPendingId(),
        type: '收获选牌',
        revealedCards,
        currentPickerIndex: 0,
        pickOrder,
        player,
        timeout,
        deadline: Date.now() + timeout,
        onTimeout: { type: '打出', player: pickOrder[0], cardId: revealedCards[0] },
      };

      const result = applyAtoms(
        { ...state, zones: { ...state.zones, deck: remainingDeck } },
        [
          { type: '移动牌', cardId: action.cardId, from: { zone: '手牌', player }, to: { zone: '弃牌堆' } },
          { type: '推入待定', action: harvestPending },
        ],
      );
      const harvestRevealLogEntry = makeLogEntry({ type: 'harvestReveal', cards: revealedCards } as unknown as Atom);
      return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry, harvestRevealLogEntry] };
    }

    // ── 可被无懈可击的锦囊（有目标）：先弃源牌，开 trickResponse ──
    case '过河拆桥':
    case '顺手牵羊':
    case '决斗': {
      const target = action.target;
      if (!target) return { state, logEntries: [], error: `${card.name}需要指定目标` };

      // 校验目标存活
      const targetPlayer = getPlayer(state, target);
      if (!targetPlayer.info.alive) return { state, logEntries: [], error: '目标已阵亡' };

      // 顺手牵羊距离检查
      if (card.name === '顺手牵羊' && getDistance(state, player, target) !== 1) {
        return { state, logEntries: [], error: '顺手牵羊目标距离必须为 1' };
      }

      // 过河拆桥/顺手牵羊需要目标有手牌
      if ((card.name === '过河拆桥' || card.name === '顺手牵羊') && targetPlayer.hand.length === 0) {
        return { state, logEntries: [], error: '目标没有手牌' };
      }

      // 1. 弃掉源牌
      const moveAtom: Atom = {
        type: '移动牌',
        cardId: action.cardId,
        from: { zone: '手牌', player },
        to: { zone: '弃牌堆' },
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
        return { state: trickResult.state, logEntries: [...trickResult.logEntries, cardPlayedLogEntry] };
      }

      const trickResponse = createConcurrentTrickResponse(state, {
        sourceCard: action.cardId,
        attacker: player,
        trickTarget: target,
        responders: allPlayers,
        depth: 0,
      });

      const result = applyAtoms(state, [moveAtom, { type: '推入待定', action: trickResponse }]);
      return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
    }

    // ── 延迟锦囊：出牌时不问无懈可击，直接放入判定区 ──
    // 无懈可击在判定阶段执行判定前询问
    case '乐不思蜀':
    case '兵粮寸断': {
      const target = action.target;
      if (!target) return { state, logEntries: [], error: `${card.name}需要指定目标` };

      const targetPlayer = getPlayer(state, target);
      if (!targetPlayer.info.alive) return { state, logEntries: [], error: '目标已阵亡' };

      const trick = { name: card.name, source: player, card };
      const result = applyAtoms(state, [
        { type: '移动牌', cardId: action.cardId, from: { zone: '手牌', player }, to: { zone: '弃牌堆' } },
        { type: '添加延时锦囊', player: target, trick },
      ]);
      return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
    }

    // ── AOE：先问无懈可击，再每个其他玩家依次响应（南蛮入侵→出杀，万箭齐发→出闪） ──
    case '南蛮入侵':
    case '万箭齐发': {
      const requiredCard = card.name === '南蛮入侵' ? '杀' : '闪';

      const startIdx = state.playerOrder.indexOf(player);
      const affected: string[] = [];
      for (let i = 1; i < state.playerOrder.length; i++) {
        const name = state.playerOrder[(startIdx + i) % state.playerOrder.length];
        if (getPlayer(state, name).info.alive) affected.push(name);
      }

      const moveAtom: Atom = {
        type: '移动牌',
        cardId: action.cardId,
        from: { zone: '手牌', player },
        to: { zone: '弃牌堆' },
      };

      if (affected.length === 0) {
        const result = applyAtoms(state, [moveAtom]);
        return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
      }

      const { state: movedState, logEntries: moveLogEntries } = applyAtoms(state, [moveAtom]);
      const wuxieResult = startAoeTargetWuxie(movedState, {
        attacker: player,
        remainingTargets: affected,
        requiredCard,
        sourceCard: action.cardId,
      });

      return {
        state: wuxieResult.state,
        logEntries: [...moveLogEntries, ...wuxieResult.logEntries, cardPlayedLogEntry],
      };
    }

    // ── 其他锦囊（无懈可击等） ──
    default: {
      const atoms: Atom[] = [
        {
          type: '移动牌',
          cardId: action.cardId,
          from: { zone: '手牌', player },
          to: { zone: '弃牌堆' },
        },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, logEntries: [...result.logEntries, cardPlayedLogEntry] };
    }
  }
}

function handleEquipCard(
  state: GameState,
  action: GameAction & { type: '打出一张牌' },
  card: Card,
): EngineResult {
  const player = action.player;
  const subtypeToSlot: Record<string, EquipSlot> = {
    武器: '武器',
    防具: '防具',
    进攻马: '进攻马',
    防御马: '防御马',
  };
  const slot = subtypeToSlot[card.subtype];
  const oldEquipId = slot ? state.players[player].equipment[slot] : undefined;
  // 装备替换：卸旧装新
  if (oldEquipId) {
    // v2 trigger 已删除，无需 unregisterEquipmentTriggers
  }

  const result = applyAtoms(state, [{ type: '装备', player, cardId: action.cardId }]);
  const after = result.state;

  const cardPlayedLogEntry = makeLogEntry({ type: '出牌', player, cardId: action.cardId } as unknown as Atom);
  return { state: after, logEntries: [...result.logEntries, cardPlayedLogEntry] };
}

// ── 五谷丰登选牌处理 ──────────────────────────────────────

export function resolveHarvestSelection(
  state: GameState,
  action: GameAction,
  pending: PendingHarvestSelection,
): EngineResult {
  if (action.type !== '打出') {
    return { state, logEntries: [], error: '选牌需要 respond 动作' };
  }

  const currentPicker = pending.pickOrder[pending.currentPickerIndex];
  if (action.player !== currentPicker) {
    return { state, logEntries: [], error: '还没轮到你选牌' };
  }

  const selectedId = action.cardId ?? pending.revealedCards[0];
  let newRevealed = pending.revealedCards;

  if (!newRevealed.includes(selectedId)) {
    return { state, logEntries: [], error: '选择的卡牌不在翻出的牌中' };
  }
  newRevealed = newRevealed.filter(id => id !== selectedId);

  const nextIndex = pending.currentPickerIndex + 1;

  if (nextIndex >= pending.pickOrder.length) {
    // 所有人都选完了，剩余牌进弃牌堆
    const atoms: Atom[] = [
      { type: '弹出待定' },
      ...newRevealed.map(id => ({
        type: '移动牌' as const,
        cardId: id,
        from: { zone: '牌堆' as const },
        to: { zone: '弃牌堆' as const },
      })),
    ];
    if (selectedId) {
      atoms.unshift({
        type: '移动牌',
        cardId: selectedId,
        from: { zone: '牌堆' },
        to: { zone: '手牌', player: action.player },
      });
    }
    const result = applyAtoms(state, atoms);
    const harvestDoneLogEntry = makeLogEntry({ type: 'harvestDone', player: action.player, cardId: selectedId ?? null } as unknown as Atom);
    return { state: result.state, logEntries: [...result.logEntries, harvestDoneLogEntry] };
  }

  // 还有下一位选牌者
  const nextPicker = pending.pickOrder[nextIndex];
  const atoms: Atom[] = [];
  if (selectedId) {
    atoms.push({
      type: '移动牌',
      cardId: selectedId,
      from: { zone: '牌堆' },
      to: { zone: '手牌', player: action.player },
    });
  }
  const timeout = TIMEOUT_DEFAULTS.harvestSelection;
  const nextPending: PendingHarvestSelection = {
    ...pending,
    revealedCards: newRevealed,
    currentPickerIndex: nextIndex,
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: '打出', player: nextPicker, cardId: newRevealed[0] },
  };
  atoms.push({ type: '推入待定', action: nextPending });

  // 如果在同一个调用中既有 moveCard 又有 pushPending，先 pop 再 push
  const popThenPush = [{ type: '弹出待定' as const }, ...atoms];
  const result = applyAtoms(state, popThenPush);
  return { state: result.state, logEntries: result.logEntries };
}
