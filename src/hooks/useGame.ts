import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { GameState, Card } from '../../shared/types';
import { createGame, startGame, getCurrentPlayer } from '../../engine/state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard } from '../../engine/turn';
import { playPeach, playDismantle, playSteal, playDrawTwo, playArrowBarrage, playBarbarianInvasion, playPeachGarden, playAbundance } from '../../engine/effect';
import { getValidActions, getValidTargetsForCard, isCardPlayable } from '../../engine/rules';
import { GameLogger } from '../../engine/logger';
import { checkDying, getDyingOptions, applyDying, applyPeachSave } from '../../engine/dying';
import { 曹操, 刘备, 孙权, 诸葛亮, 司马懿 } from '../../shared/characters';
import type { Operation } from '../../shared/log';
import { saveLog } from '../utils/logFile';

const CHARACTERS = [曹操, 刘备, 孙权, 诸葛亮, 司马懿];
const PLAYER_NAMES = CHARACTERS.map(c => c.name);

// 待响应状态
interface PendingResponse {
  type: '杀';
  attacker: string;
  target: string;
  card: Card;
}

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

// 旋转数组，使指定名字的玩家在首位
function rotatePlayers(names: string[], startName: string): string[] {
  const idx = names.indexOf(startName);
  if (idx <= 0) return names;
  return [...names.slice(idx), ...names.slice(0, idx)];
}

export function useGame() {
  const loggerRef = useRef<GameLogger | null>(null);
  loggerRef.current ??= new GameLogger({
    version: '1.0.0',
    createdAt: Date.now(),
    playerCount: CHARACTERS.length,
    characters: PLAYER_NAMES,
    seed: Date.now(),
  });
  const logger = loggerRef.current;

  const initRef = useRef(false);
  const [playerOps, setPlayerOps] = useState<Operation[]>([]);
  const [myName, setMyName] = useState('曹操');
  const [playerOrder, setPlayerOrder] = useState<string[]>(PLAYER_NAMES);

  // 待响应状态（杀 → 闪）
  const [pendingResponse, setPendingResponse] = useState<PendingResponse | null>(null);

  // 濒死救援状态
  const [pendingDying, setPendingDying] = useState<{ player: string; savers: string[] } | null>(null);

  // 本回合是否已出过杀
  const [hasUsedKillThisTurn, setHasUsedKillThisTurn] = useState(false);

  // 弃牌选择
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<number>>(new Set());

  // 计时器 — 每次操作后重置
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [timerPaused, setTimerPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetTimer = useCallback(() => {
    setTimerSeconds(60);
  }, []);

  const [game, setGame] = useState<GameState>(() => {
    if (initRef.current) {
      return createGame(CHARACTERS);
    }
    initRef.current = true;
    const initial = createGame(CHARACTERS);
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

  // 计时器逻辑
  useEffect(() => {
    if (game.status !== '进行中' || timerPaused || !isMyTurn) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    setTimerSeconds(60);
    timerRef.current = setInterval(() => {
      setTimerSeconds(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [game.currentPlayer, game.round, timerPaused, game.status, isMyTurn]);

  useEffect(() => {
    if (timerSeconds === 0 && isMyTurn && game.phase === '出牌' && !pendingResponse && !pendingDying) {
      handleEndTurn();
    }
  }, [timerSeconds, isMyTurn, game.phase, pendingResponse, pendingDying]);

  // 回合切换时重置杀的使用状态
  useEffect(() => {
    setHasUsedKillThisTurn(false);
  }, [game.currentPlayer, game.round]);

  const validActions = useMemo(() => getValidActions(game, myName), [game, myName]);
  const needsTarget = selectedCard !== null && validActions.validTargets.has(selectedCard);

  const canPlay = selectedCard !== null && isMyTurn && game.phase === '出牌' && !pendingResponse && !pendingDying && (() => {
    const card = me.hand[selectedCard];
    if (!card) return false;
    // 诸葛连弩可以无限出杀
    const hasUnlimitedKill = me.equipment.weapon?.name === '诸葛连弩';
    if (card.name === '杀' && hasUsedKillThisTurn && !hasUnlimitedKill) return false;
    if (!isCardPlayable(game, me, card)) return false;
    if (needsTarget && !selectedTarget) return false;
    return true;
  })();

  // 弃牌阶段逻辑
  const needsDiscard = isMyTurn && game.phase === '弃牌' && me.hand.length > me.maxHealth;
  const discardCount = needsDiscard ? me.hand.length - me.maxHealth : 0;

  const toggleDiscardSelection = useCallback((index: number) => {
    setSelectedForDiscard(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else if (next.size < discardCount) {
        next.add(index);
      }
      return next;
    });
  }, [discardCount]);

  const handleDiscard = useCallback(() => {
    if (!needsDiscard || selectedForDiscard.size !== discardCount) return;

    const indices = Array.from(selectedForDiscard).sort((a, b) => b - a);
    const newGame = executeDiscard(game, indices, logger);
    setGame(newGame);
    setSelectedForDiscard(new Set());
    setSelectedCard(null);
    updateOps();
    resetTimer();
  }, [game, needsDiscard, selectedForDiscard, discardCount, logger, updateOps]);

  // 切换视角（旋转座位）
  const switchPerspective = useCallback(() => {
    const currentIndex = PLAYER_NAMES.indexOf(myName);
    const nextIndex = (currentIndex + 1) % PLAYER_NAMES.length;
    const nextName = PLAYER_NAMES[nextIndex];
    setMyName(nextName);
    setPlayerOrder(rotatePlayers(PLAYER_NAMES, nextName));
    setPlayerOps(logger.export().playerOps[nextName] ?? []);
    setSelectedCard(null);
    setSelectedTarget(null);
  }, [myName, logger]);

  const goToCurrentPlayer = useCallback(() => {
    setMyName(game.currentPlayer);
    setPlayerOrder(rotatePlayers(PLAYER_NAMES, game.currentPlayer));
    setPlayerOps(logger.export().playerOps[game.currentPlayer] ?? []);
    setSelectedCard(null);
    setSelectedTarget(null);
  }, [game.currentPlayer, logger]);

  const toggleTimer = useCallback(() => setTimerPaused(prev => !prev), []);

  const handleSaveLog = useCallback(() => saveLog(logger.export()), [logger]);

  // 响应杀（出闪或不出）
  const respondToKill = useCallback((playDodge: boolean) => {
    if (!pendingResponse) return;

    const { attacker, target, card } = pendingResponse;

    if (playDodge) {
      // 目标出闪，取消伤害
      logger.logServerOp('play', { player: target, card: '闪', response: '杀' }, `${target} 出了闪，抵消了杀`);
      logger.logPlayerOp(target, 'play', { player: target, card: '闪' }, `你出了闪，抵消了 ${attacker} 的杀`);
      logger.logPlayerOp(attacker, 'play', { player: target, card: '闪', response: '杀' }, `${target} 出了闪，你的杀被抵消`);

      // 从目标手牌移除一张闪
      setGame(prev => ({
        ...prev,
        players: prev.players.map(p => {
          if (p.name === target) {
            const idx = p.hand.findIndex(c => c.name === '闪');
            if (idx >= 0) {
              const newHand = [...p.hand];
              newHand.splice(idx, 1);
              return { ...p, hand: newHand };
            }
          }
          return p;
        }),
      }));
    } else {
      // 目标不出闪，受到伤害
      logger.logServerOp('damage', { source: attacker, target, amount: 1, cardName: '杀' }, `${attacker} 对 ${target} 使用杀，造成1点伤害`);
      for (const p of game.players) {
        logger.logPlayerOp(p.name, 'damage', { source: attacker, target, amount: 1 }, `${attacker} 对 ${target} 使用杀，造成1点伤害`);
      }

      // Apply damage and check for dying
      const targetPlayer = game.players.find(p => p.name === target);
      if (targetPlayer) {
        const newHealth = targetPlayer.health - 1;
        if (checkDying(newHealth)) {
          // Player is dying - get rescue options from current game state
          const options = getDyingOptions(game, target);

          // Apply damage (reduce health)
          setGame(prev => ({
            ...prev,
            players: prev.players.map(p =>
              p.name === target ? { ...p, health: newHealth } : p,
            ),
          }));

          if (options.savers.length > 0) {
            // Show rescue prompt
            setPendingDying({ player: target, savers: options.savers });
          } else {
            // No savers, player dies immediately
            logger.logServerOp('gameEnd', { player: target }, `${target} 阵亡`);
            setGame(prev => applyDying(prev, target));
          }
        } else {
          // Not dying, just apply damage normally
          setGame(prev => ({
            ...prev,
            players: prev.players.map(p =>
              p.name === target ? { ...p, health: newHealth } : p,
            ),
          }));
        }
      }
    }

    // 从攻击者手牌移除杀
    setGame(prev => ({
      ...prev,
      players: prev.players.map(p => {
        if (p.name === attacker) {
          const idx = p.hand.findIndex(c => c.name === card.name && c.suit === card.suit && c.rank === card.rank);
          if (idx >= 0) {
            const newHand = [...p.hand];
            newHand.splice(idx, 1);
            return { ...p, hand: newHand };
          }
        }
        return p;
      }),
    }));

    setPendingResponse(null);
    updateOps();
    resetTimer();
  }, [pendingResponse, game, logger, updateOps]);

  // 响应濒死救援
  const respondToDying = useCallback((saverName: string | null) => {
    if (!pendingDying) return;

    if (saverName) {
      // Someone uses 桃 to save
      const newGame = applyPeachSave(game, saverName, pendingDying.player);
      setGame(newGame);
      logger.logServerOp('heal', { player: saverName, target: pendingDying.player, amount: 1 }, `${saverName} 使用桃救援 ${pendingDying.player}`);
      logger.logPlayerOp(saverName, 'heal', { player: saverName, target: pendingDying.player, amount: 1 }, `你使用桃救援 ${pendingDying.player}`);
      logger.logPlayerOp(pendingDying.player, 'heal', { player: saverName, target: pendingDying.player, amount: 1 }, `${saverName} 使用桃救援了你`);
    } else {
      // No one saves, player dies
      const newGame = applyDying(game, pendingDying.player);
      setGame(newGame);
      logger.logServerOp('gameEnd', { player: pendingDying.player }, `${pendingDying.player} 阵亡`);
    }

    setPendingDying(null);
    updateOps();
    resetTimer();
  }, [game, pendingDying, logger, updateOps]);

  const handlePlayCard = useCallback(() => {
    if (selectedCard === null || !isMyTurn || pendingResponse || pendingDying) return;

    const card = me.hand[selectedCard];
    if (!card || !isCardPlayable(game, me, card)) return;

    if (card.name === '杀') {
      const target = selectedTarget ?? getValidTargetsForCard(game, me, card)[0];
      if (!target) return;

      // 设置待响应状态，切换到目标视角
      logger.logServerOp('play', { player: me.name, card: card.name, target }, `${me.name} 对 ${target} 使用杀`);
      logger.logPlayerOp(me.name, 'play', { player: me.name, card: card.name, target }, `你对 ${target} 使用杀`);
      logger.logPlayerOp(target, 'play', { player: me.name, card: card.name, target }, `${me.name} 对你使用杀，请响应`);

      setPendingResponse({ type: '杀', attacker: me.name, target, card });
      setHasUsedKillThisTurn(true);
      setMyName(target);
      setPlayerOrder(rotatePlayers(PLAYER_NAMES, target));
      setPlayerOps(logger.export().playerOps[target] ?? []);
      setSelectedCard(null);
      setSelectedTarget(null);
      return;
    }

    // 其他卡牌的处理
    let newGame = game;
    let success = false;

    if (card.name === '桃') {
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
    } else if (card.name === '五谷丰登') {
      const result = playAbundance(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '乐不思蜀' || card.name === '兵粮寸断' || card.name === '闪电') {
      // 延时锦囊：添加到目标的判定区
      const target = selectedTarget ?? getValidTargetsForCard(game, me, card)[0];
      if (target) {
        const pendingTrick = { name: card.name, source: me.name, card };
        newGame = {
          ...game,
          players: game.players.map(p =>
            p.name === target
              ? { ...p, pendingTricks: [...(p.pendingTricks ?? []), pendingTrick] }
              : p,
          ),
        };
        success = true;
        logger.logServerOp('play', { player: me.name, card: card.name, target }, `${me.name} 对 ${target} 使用了 ${card.name}`);
        logger.logPlayerOp(me.name, 'play', { player: me.name, card: card.name, target }, `你对 ${target} 使用了 ${card.name}`);
        logger.logPlayerOp(target, 'play', { player: me.name, card: card.name, target }, `${me.name} 对你使用了 ${card.name}`);
      }
    }

    if (success) {
      const playedCard = me.hand[selectedCard];
      const newHand = [...me.hand];
      newHand.splice(selectedCard, 1);
      setGame({
        ...newGame,
        players: newGame.players.map(p =>
          p.name === me.name ? { ...p, hand: newHand } : p,
        ),
        discardPile: [...newGame.discardPile, playedCard],
      });
      updateOps();
      resetTimer();
    }

    setSelectedCard(null);
    setSelectedTarget(null);
  }, [game, selectedCard, selectedTarget, me, isMyTurn, pendingResponse, pendingDying, logger, updateOps]);

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn || pendingResponse || pendingDying) return;

    let newGame = game;

    // 如果在弃牌阶段且需要弃牌，必须先弃牌
    if (newGame.phase === '弃牌' && checkDiscard(newGame)) {
      return; // 等待玩家通过弃牌 UI 弃牌
    }

    // 推进到下一阶段
    newGame = nextPhase(newGame, logger);

    // 如果进入弃牌阶段且需要弃牌，停下来等玩家弃牌
    if (newGame.phase === '弃牌' && checkDiscard(newGame)) {
      setGame(newGame);
      setSelectedCard(null);
      setSelectedTarget(null);
      updateOps();
      resetTimer();
      return;
    }

    // 否则跳过弃牌和结束阶段，进入下一个玩家的出牌阶段
    newGame = nextPhase(newGame, logger); // 弃牌 → 结束
    newGame = nextPhase(newGame, logger); // 结束 → 准备
    newGame = advanceToPlayPhase(newGame, logger);
    setGame(newGame);
    setSelectedCard(null);
    setSelectedTarget(null);
    setSelectedForDiscard(new Set());
    updateOps();
    resetTimer();
  }, [game, isMyTurn, pendingResponse, pendingDying, logger, updateOps]);

  const selectCard = useCallback((index: number | null) => {
    setSelectedCard(index);
    setSelectedTarget(null);
    resetTimer();
  }, [resetTimer]);

  // 有 pendingResponse 时，检查目标是否有闪
  const targetHasDodge = pendingResponse
    ? game.players.find(p => p.name === pendingResponse.target)?.hand.some(c => c.name === '闪') ?? false
    : false;

  return {
    game,
    currentPlayer,
    me,
    myName,
    playerOrder,
    isMyTurn,
    selectedCard,
    selectCard,
    selectedTarget,
    setSelectedTarget,
    canPlay,
    validActions,
    playerOps,
    timerSeconds,
    timerPaused,
    toggleTimer,
    switchPerspective,
    goToCurrentPlayer,
    pendingResponse,
    targetHasDodge,
    respondToKill,
    pendingDying,
    respondToDying,
    needsDiscard,
    discardCount,
    selectedForDiscard,
    toggleDiscardSelection,
    handleDiscard,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  };
}
