import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { GameState, Card } from '../../shared/types';
import { GameLogger } from '../../engine/logger';
import { GameController } from '../../engine/game';
import { createGame, getCurrentPlayer } from '../../engine/state';
import { checkDiscard } from '../../engine/turn';
import { getValidActions } from '../../engine/validation';
import { getDistance, getAttackRange } from '../../engine/distance';
import { 曹操, 刘备, 孙权, 诸葛亮, 司马懿 } from '../../shared/characters';
import type { Operation } from '../../shared/log';
import { saveLog } from '../utils/logFile';

const CHARACTERS = [曹操, 刘备, 孙权, 诸葛亮, 司马懿];
const PLAYER_NAMES = CHARACTERS.map(c => c.name);

export function getValidTargets(game: GameState, playerName: string, card: Card): string[] {
  const player = game.players.find(p => p.name === playerName);
  if (!player) return [];
  const others = game.players.filter(p => p.name !== playerName && p.alive);

  switch (card.name) {
    case '杀':
      return others
        .filter(p => getDistance(game, playerName, p.name) <= getAttackRange(player))
        .map(p => p.name);
    case '过河拆桥':
      return others.filter(p => p.hand.length > 0 || Object.values(p.equipment).some(Boolean)).map(p => p.name);
    case '顺手牵羊':
      return others
        .filter(p => getDistance(game, playerName, p.name) <= 1)
        .filter(p => p.hand.length > 0 || Object.values(p.equipment).some(Boolean))
        .map(p => p.name);
    case '决斗':
    case '乐不思蜀':
    case '兵粮寸断':
      return others.map(p => p.name);
    default:
      return [];
  }
}

function rotatePlayers(names: string[], startName: string): string[] {
  const idx = names.indexOf(startName);
  if (idx <= 0) return names;
  return [...names.slice(idx), ...names.slice(0, idx)];
}

export function useGame() {
  // 游戏控制器
  const controllerRef = useRef<GameController | null>(null);
  const loggerRef = useRef<GameLogger | null>(null);

  loggerRef.current ??= new GameLogger({
    version: '1.0.0',
    createdAt: Date.now(),
    playerCount: CHARACTERS.length,
    characters: PLAYER_NAMES,
    seed: Date.now(),
  });

  const initRef = useRef(false);
  const [game, setGame] = useState<GameState>(() => {
    if (initRef.current) {
      return createGame(CHARACTERS);
    }
    initRef.current = true;
    const { state, controller } = GameController.createGame(CHARACTERS, undefined, loggerRef.current!);
    controllerRef.current = controller;
    return state;
  });

  // UI 状态
  const [myName, setMyName] = useState('曹操');
  const [playerOrder, setPlayerOrder] = useState<string[]>(PLAYER_NAMES);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [playerOps, setPlayerOps] = useState<Operation[]>([]);

  // 响应状态
  const [pendingResponse, setPendingResponse] = useState<{ attacker: string; target: string; card: Card } | null>(null);
  const [pendingDying, setPendingDying] = useState<{ player: string; savers: string[] } | null>(null);

  // 弃牌状态
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<number>>(new Set());

  // 计时器
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [timerPaused, setTimerPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const controller = controllerRef.current!;
  const logger = loggerRef.current;

  const currentPlayer = getCurrentPlayer(game);
  const me = game.players.find(p => p.name === myName)!;
  const isMyTurn = game.currentPlayer === myName;

  // 计时器逻辑
  const resetTimer = useCallback(() => setTimerSeconds(60), []);

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

  // 计时器到期处理
  useEffect(() => {
    if (timerSeconds !== 0 || !isMyTurn || pendingResponse || pendingDying) return;

    if (game.phase === '弃牌' && checkDiscard(game)) {
      // 弃牌阶段超时：自动弃牌
      const excess = me.hand.length - me.maxHealth;
      const indices = Array.from({ length: excess }, (_, i) => me.hand.length - 1 - i);
      const result = controller.discard(myName, indices);
      setGame(result.state);
      setSelectedForDiscard(new Set());
      setSelectedCard(null);
      updateOps();
    }
    // 出牌阶段不自动结束回合，让玩家手动结束
  }, [timerSeconds, isMyTurn, game.phase, pendingResponse, pendingDying]);

  // 更新操作日志
  const updateOps = useCallback(() => {
    setPlayerOps(logger.export().playerOps[myName] ?? []);
  }, [logger, myName]);

  // 规则引擎
  const validActions = useMemo(() => getValidActions(game, myName), [game, myName]);

  const canPlay = selectedCard !== null && isMyTurn && game.phase === '出牌' && !pendingResponse && !pendingDying && (() => {
    const card = me.hand[selectedCard];
    if (!card) return false;
    const hasUnlimitedKill = me.equipment.weapon?.name === '诸葛连弩';
    if (card.name === '杀' && hasUnlimitedKill) return true; // TODO: track kill count
    return true;
  })();

  // 弃牌逻辑
  const needsDiscard = isMyTurn && game.phase === '弃牌' && me.hand.length > me.maxHealth;
  const discardCount = needsDiscard ? me.hand.length - me.maxHealth : 0;

  // 技能
  const availableSkills = useMemo(() => {
    if (!isMyTurn || pendingResponse || pendingDying) return [];
    return controller.getState().players.find(p => p.name === myName)?.character.abilities
      .filter(a => !a.passive)
      .map((a, i) => ({ ability: a, playerName: myName, canActivate: true, index: i })) ?? [];
  }, [game, myName, isMyTurn, pendingResponse, pendingDying]);

  // ============================================================
  // 操作处理
  // ============================================================

  const handlePlayCard = useCallback(() => {
    if (selectedCard === null || !isMyTurn) return;

    const card = me.hand[selectedCard];
    if (!card) return;

    const result = controller.playCard(myName, card.id, selectedTarget ?? undefined);

    // 处理需要响应窗口的情况
    if (result.responseWindow) {
      setGame(result.state);
      setSelectedCard(null);
      setSelectedTarget(null);
      updateOps();
      resetTimer();
      // 根据响应窗口类型设置 pending 状态
      if (result.responseWindow.type === 'kill_response') {
        setPendingResponse({
          attacker: result.responseWindow.requester,
          target: result.responseWindow.validResponders[0],
          card: result.responseWindow.sourceCard!,
        });
      }
      return;
    }

    if (result.success) {
      setGame(result.state);
      setSelectedCard(null);
      setSelectedTarget(null);
      updateOps();
      resetTimer();
    }
  }, [game, selectedCard, selectedTarget, isMyTurn, controller, updateOps, resetTimer]);

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn || pendingResponse || pendingDying) return;

    // 如果需要弃牌，先弃牌
    if (needsDiscard && selectedForDiscard.size === discardCount) {
      const indices = Array.from(selectedForDiscard).sort((a, b) => b - a);
      const result = controller.discard(myName, indices);
      setGame(result.state);
      setSelectedForDiscard(new Set());
      setSelectedCard(null);
      updateOps();
      resetTimer();
      return;
    }

    const result = controller.endTurn(myName);

    if (result.success) {
      setGame(result.state);
      setSelectedCard(null);
      setSelectedTarget(null);
      setSelectedForDiscard(new Set());
      updateOps();
      resetTimer();
    }
  }, [game, isMyTurn, pendingResponse, pendingDying, needsDiscard, selectedForDiscard, discardCount, controller, updateOps, resetTimer]);

  const handleDiscard = useCallback(() => {
    if (!needsDiscard || selectedForDiscard.size !== discardCount) return;

    const indices = Array.from(selectedForDiscard).sort((a, b) => b - a);
    const result = controller.discard(myName, indices);

    setGame(result.state);
    setSelectedForDiscard(new Set());
    setSelectedCard(null);
    updateOps();
    resetTimer();
  }, [game, needsDiscard, selectedForDiscard, discardCount, myName, controller, updateOps, resetTimer]);

  const respondToKill = useCallback((playDodge: boolean) => {
    if (!pendingResponse) return;

    // 构建响应 Map
    const responses = new Map<string, Card | null>();
    if (playDodge) {
      // 找到一张闪
      const targetPlayer = game.players.find(p => p.name === pendingResponse.target);
      const dodgeCard = targetPlayer?.hand.find(c => c.name === '闪');
      responses.set(pendingResponse.target, dodgeCard ?? null);
    } else {
      responses.set(pendingResponse.target, null);
    }

    const result = controller.respondToWindow(responses);

    setGame(result.state);
    updateOps();

    // 检查是否触发濒死
    if (result.responseWindow?.type === 'dying') {
      setPendingDying({
        player: result.responseWindow.requester,
        savers: result.responseWindow.validResponders,
      });
    } else {
      setPendingResponse(null);
      setPendingDying(null);
      // 切换回攻击者视角
      setMyName(pendingResponse.attacker);
      setPlayerOrder(rotatePlayers(PLAYER_NAMES, pendingResponse.attacker));
    }
  }, [game, pendingResponse, controller, updateOps]);

  const respondToDying = useCallback((saverName: string | null) => {
    if (!pendingDying) return;

    // 构建响应 Map
    const responses = new Map<string, Card | null>();
    if (saverName) {
      // 找到一张桃
      const saverPlayer = game.players.find(p => p.name === saverName);
      const peachCard = saverPlayer?.hand.find(c => c.name === '桃');
      responses.set(saverName, peachCard ?? null);
    }

    const result = controller.respondToWindow(responses);

    setGame(result.state);
    setPendingDying(null);
    setPendingResponse(null);
    updateOps();
  }, [game, pendingDying, controller, updateOps]);

  const handleActivateSkill = useCallback((skillIndex: number) => {
    if (!isMyTurn) return;

    const result = controller.activateSkill(myName, skillIndex);
    if (result.success) {
      setGame(result.state);
      updateOps();
      resetTimer();
    }
  }, [game, isMyTurn, myName, controller, updateOps, resetTimer]);

  // ============================================================
  // UI 操作
  // ============================================================

  const switchPerspective = useCallback(() => {
    const idx = PLAYER_NAMES.indexOf(myName);
    const nextName = PLAYER_NAMES[(idx + 1) % PLAYER_NAMES.length];
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

  const selectCard = useCallback((index: number | null) => {
    setSelectedCard(index);
    setSelectedTarget(null);
    resetTimer();
  }, [resetTimer]);

  const toggleDiscardSelection = useCallback((index: number) => {
    setSelectedForDiscard(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else if (next.size < discardCount) next.add(index);
      return next;
    });
  }, [discardCount]);

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
    availableSkills,
    handleActivateSkill,
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
