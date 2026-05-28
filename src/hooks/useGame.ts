import { useState, useCallback, useRef, useMemo } from 'react';
import type { GameState } from '../../shared/types';
import { createGame, startGame, getCurrentPlayer } from '../../engine/state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard } from '../../engine/turn';
import {
  playKill, playPeach,
  playDismantle, playSteal, playDrawTwo,
  playArrowBarrage, playBarbarianInvasion, playPeachGarden,
} from '../../engine/effect';
import { getValidActions, getValidTargetsForCard, isCardPlayable } from '../../engine/rules';
import { GameLogger } from '../../engine/logger';
import { 曹操, 刘备 } from '../../shared/characters';
import type { Operation } from '../../shared/log';
import { saveLog } from '../utils/logFile';

function advanceToPlayPhase(game: GameState, logger: InstanceType<typeof GameLogger>): GameState {
  let state = game;
  while (state.phase !== '出牌') {
    if (state.phase === '摸牌') {
      const result = drawPhase(state, logger);
      state = result.status;
    }
    state = nextPhase(state, logger);
  }
  return state;
}

export function useGame() {
  const loggerRef = useRef<GameLogger | null>(null);
  loggerRef.current ??= new GameLogger({
    version: '1.0.0',
    createdAt: Date.now(),
    playerCount: 2,
    characters: ['曹操', '刘备'],
    seed: Date.now(),
  });
  const logger = loggerRef.current;

  const initRef = useRef(false);
  const [playerOps, setPlayerOps] = useState<Operation[]>([]);
  const [myName, setMyName] = useState('曹操');

  const [game, setGame] = useState<GameState>(() => {
    if (initRef.current) {
      return createGame([曹操, 刘备]);
    }
    initRef.current = true;
    const initial = createGame([曹操, 刘备]);
    const started = startGame(initial, logger);
    const advanced = advanceToPlayPhase(started, logger);
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
    return advanced;
  });

  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const updateOps = useCallback(() => {
    setPlayerOps(logger.export().playerOps[myName] ?? []);
  }, [logger, myName]);

  const currentPlayer = getCurrentPlayer(game);
  const me = game.players.find(p => p.name === myName)!;
  const isMyTurn = game.currentPlayer === myName;

  // 使用规则引擎获取可用操作
  const validActions = useMemo(() => getValidActions(game, myName), [game, myName]);

  // 选中的牌是否需要目标
  const needsTarget = selectedCard !== null && validActions.validTargets.has(selectedCard);

  // 当前选中的牌是否可以出
  const canPlay = selectedCard !== null && isMyTurn && game.phase === '出牌' && (() => {
    const card = me.hand[selectedCard];
    if (!card) return false;
    if (!isCardPlayable(game, me, card)) return false;
    if (needsTarget && !selectedTarget) return false;
    return true;
  })();

  const switchPerspective = useCallback(() => {
    const nextName = myName === '曹操' ? '刘备' : '曹操';
    setMyName(nextName);
    setPlayerOps(logger.export().playerOps[nextName] ?? []);
    setSelectedCard(null);
    setSelectedTarget(null);
  }, [myName, logger]);

  const handleSaveLog = useCallback(() => {
    saveLog(logger.export());
  }, [logger]);

  const handlePlayCard = useCallback(() => {
    if (selectedCard === null || !isMyTurn) return;

    const card = me.hand[selectedCard];
    if (!card || !isCardPlayable(game, me, card)) return;

    let newGame = game;
    let success = false;

    if (card.name === '杀') {
      const target = selectedTarget ?? getValidTargetsForCard(game, me, card)[0];
      if (target) {
        const result = playKill(game, me.name, target, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '桃') {
      const result = playPeach(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.subtype === '武器' || card.subtype === '防具' || card.subtype === '进攻马' || card.subtype === '防御马') {
      success = true;
      const eq = { ...me.equipment };
      if (card.subtype === '武器') eq.weapon = card;
      else if (card.subtype === '防具') eq.armor = card;
      else if (card.subtype === '进攻马') eq.horseMinus = card;
      else if (card.subtype === '防御马') eq.horsePlus = card;
      newGame = { ...game, players: game.players.map(p => p.name === me.name ? { ...p, equipment: eq } : p) };
      logger.logServerOp('equip', { player: me.name, card: card.name }, `${me.name} 装备了 ${card.name}`);
      logger.logPlayerOp(me.name, 'equip', { player: me.name, card: card.name }, `你装备了 ${card.name}`);
    } else if (card.name === '过河拆桥') {
      const target = selectedTarget ?? getValidTargetsForCard(game, me, card)[0];
      if (target) {
        const result = playDismantle(game, me.name, target, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '顺手牵羊') {
      const target = selectedTarget ?? getValidTargetsForCard(game, me, card)[0];
      if (target) {
        const result = playSteal(game, me.name, target, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '无中生有') {
      const result = playDrawTwo(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '桃园结义') {
      const result = playPeachGarden(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '万箭齐发') {
      const result = playArrowBarrage(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '南蛮入侵') {
      const result = playBarbarianInvasion(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    }

    if (success) {
      const newHand = [...me.hand];
      newHand.splice(selectedCard, 1);
      setGame(prev => ({ ...newGame, players: prev.players.map(p => p.name === me.name ? { ...p, hand: newHand } : p) }));
      updateOps();
    }

    setSelectedCard(null);
    setSelectedTarget(null);
  }, [game, selectedCard, selectedTarget, me, isMyTurn, logger, updateOps]);

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn) return;
    let newGame = game;
    if (newGame.phase === '弃牌') {
      const needsDiscard = checkDiscard(newGame);
      if (needsDiscard) newGame = executeDiscard(newGame, [0], logger);
    }
    newGame = nextPhase(newGame, logger);
    newGame = nextPhase(newGame, logger);
    newGame = nextPhase(newGame, logger);
    newGame = advanceToPlayPhase(newGame, logger);
    setGame(newGame);
    setSelectedCard(null);
    setSelectedTarget(null);
    updateOps();
  }, [game, isMyTurn, logger, updateOps]);

  const selectCard = useCallback((index: number | null) => {
    setSelectedCard(index);
    setSelectedTarget(null);
  }, []);

  return {
    game,
    currentPlayer,
    me,
    myName,
    isMyTurn,
    selectedCard,
    selectCard,
    selectedTarget,
    setSelectedTarget,
    canPlay,
    validActions,
    playerOps,
    switchPerspective,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  };
}
