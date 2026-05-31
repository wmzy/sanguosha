import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { engine } from '../../engine/v2/engine';
import { createInitialState, getPlayer } from '../../engine/v2/state';
import { computeValidActions } from '../../engine/v2/validate';
import { getDistance } from '../../engine/v2/distance';
import { serialize } from '../../engine/v2/serializer';
import type { GameState as V2GameState, GameAction, ValidAction, PendingAction } from '../../engine/v2/types';
import type { Card } from '../../shared/types';
import { 曹操, 刘备, 孙权, 诸葛亮, 司马懿 } from '../../shared/characters';
import { saveState } from '../utils/logFile';

const CHARACTERS = [曹操, 刘备, 孙权, 诸葛亮, 司马懿];
const PLAYER_NAMES = CHARACTERS.map(c => c.name);

/** 构建角色映射表（characterId → CharacterConfig） */
const characterMap = Object.fromEntries(CHARACTERS.map(c => [c.name, c]));

function rotatePlayers(names: string[], startName: string): string[] {
  const idx = names.indexOf(startName);
  if (idx <= 0) return names;
  return [...names.slice(idx), ...names.slice(0, idx)];
}

/** 从 pending 中提取 UI 友好的提示信息 */
interface PendingPrompt {
  type: string;
  text: string;
  responder?: string;
  attacker?: string;
  validCards?: string[];
  dyingPlayer?: string;
  savers?: string[];
  /** aoeResponse 需要的响应牌（杀/闪） */
  requiredCard?: string;
  /** selectCard 数据 */
  targetPlayer?: string;
  targetCardIds?: string[];
  selectMode?: 'discard' | 'steal';
}

function extractPendingPrompt(state: V2GameState): PendingPrompt | null {
  const pending = state.pending;
  if (!pending) return null;

  switch (pending.type) {
    case 'responseWindow':
      switch (pending.window.type) {
        case 'killResponse':
          return {
            type: 'killResponse',
            text: `${pending.window.attacker} 对你使用了杀！`,
            responder: pending.window.defender,
            attacker: pending.window.attacker,
            validCards: pending.window.validCards,
          };
        case 'aoeResponse':
          return {
            type: 'aoeResponse',
            text: pending.window.requiredCard === '杀' ? '南蛮入侵：请出杀响应' : '万箭齐发：请出闪响应',
            responder: pending.window.defender,
            attacker: pending.window.attacker,
            validCards: pending.window.validCards,
            requiredCard: pending.window.requiredCard,
          };
        case 'dyingResponse':
          return {
            type: 'dyingResponse',
            text: `${pending.window.defender} 濒死！`,
            responder: pending.window.defender,
            validCards: pending.window.validCards,
          };
        case 'duelResponse':
          return {
            type: 'duelResponse',
            text: '请出杀响应决斗',
            responder: pending.window.defender,
            validCards: pending.window.validCards,
          };
        case 'trickResponse':
          return {
            type: 'trickResponse',
            text: '请响应锦囊',
            responder: pending.window.defender,
            validCards: pending.window.validCards,
          };
      }
      break;
    case 'discardPhase':
      return {
        type: 'discardPhase',
        text: `请弃掉 ${pending.min}~${pending.max} 张牌`,
      };
    case 'dyingWindow':
      return {
        type: 'dyingWindow',
        text: `${pending.dyingPlayer} 濒死！需要桃来救援`,
        dyingPlayer: pending.dyingPlayer,
        savers: pending.savers,
      };
    case 'skillPrompt':
      return {
        type: 'skillPrompt',
        text: pending.prompt.text,
      };
    case 'selectCard':
      return {
        type: 'selectCard',
        text: pending.mode === 'steal' ? '顺手牵羊：选择要获得的牌' : '过河拆桥：选择要弃掉的牌',
        targetPlayer: pending.target,
        targetCardIds: pending.cardIds,
        selectMode: pending.mode,
      };
  }
  return null;
}

export function useGame() {
  // ── V2 引擎状态 ─────────────────────────────────────────────
  const [state, setState] = useState<V2GameState>(() => {
    const config = {
      players: CHARACTERS.map((c, i) => ({
        name: c.name,
        characterId: c.name,
        role: '主公' as const,
      })),
      seed: Date.now(),
      characterMap,
    };
    const initial = createInitialState(config);
    // 通过 startGame 触发准备→判定→摸牌→出牌的自动推进
    const result = engine(initial, { type: 'startGame' });
    return result.state;
  });

  // ── UI 状态 ─────────────────────────────────────────────────
  const [myName, setMyName] = useState(PLAYER_NAMES[0]);
  const [playerOrder, setPlayerOrder] = useState<string[]>(PLAYER_NAMES);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());

  // 计时器
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [timerPaused, setTimerPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 派生状态 ────────────────────────────────────────────────
  const me = getPlayer(state, myName);
  const isMyTurn = state.currentPlayer === myName;

  // ── 合法操作 ────────────────────────────────────────────────
  const validActions: ValidAction[] = useMemo(
    () => computeValidActions(state, myName),
    [state, myName],
  );

  // 出牌阶段的可出牌信息
  const playCardAction = validActions.find(a => a.type === 'playCard');
  const playableCards = playCardAction?.cards ?? [];

  // 响应阶段的可出牌
  const respondAction = validActions.find(a => a.type === 'respond');

  // 弃牌阶段
  const discardAction = validActions.find(a => a.type === 'discard');

  // 可用技能
  const useSkillAction = validActions.find(a => a.type === 'useSkill');
  const availableSkills = useSkillAction?.skills ?? [];

  // ── 选中牌相关 ──────────────────────────────────────────────
  const selectedCardEntry = selectedCardId !== null
    ? playableCards.find(pc => pc.cardId === selectedCardId)
    : undefined;
  const needsTarget = selectedCardId !== null && !!selectedCardEntry && selectedCardEntry.targets.length > 0;
  const validTargetList = selectedCardEntry?.targets ?? [];

  const canPlay = selectedCardId !== null && isMyTurn && state.phase === '出牌'
    && !state.pending && !!selectedCardEntry;

  // 弃牌逻辑
  const needsDiscard = discardAction != null;
  const discardMin = discardAction?.min ?? 0;
  const discardMax = discardAction?.max ?? 0;
  const discardCards = discardAction?.cards ?? [];

  // ── pending 提示 ────────────────────────────────────────────
  const pendingPrompt = useMemo(() => extractPendingPrompt(state), [state]);

  // ── 计时器逻辑 ──────────────────────────────────────────────
  const resetTimer = useCallback(() => setTimerSeconds(60), []);

  useEffect(() => {
    if (state.meta.status !== '进行中' || timerPaused || !isMyTurn) {
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
  }, [state.currentPlayer, state.meta.round, timerPaused, state.meta.status, isMyTurn]);

  // 超时自动弃牌
  useEffect(() => {
    if (timerSeconds !== 0 || !isMyTurn || state.pending) return;

    if (needsDiscard && discardAction) {
      const excess = me.hand.length - me.health;
      const cardIds = me.hand.slice(-excess);
      const result = engine(state, { type: 'discard', player: myName, cardIds });
      if (!result.error) {
        setState(result.state);
        setSelectedForDiscard(new Set());
        setSelectedCardId(null);
      }
    }
  }, [timerSeconds, isMyTurn, needsDiscard, discardAction, state, myName, me]);

  // ── dispatch helper ─────────────────────────────────────────
  const dispatch = useCallback((action: GameAction) => {
    const result = engine(state, action);
    if (result.error) return;
    setState(result.state);
    resetTimer();
  }, [state, resetTimer]);

  // ── 操作处理 ────────────────────────────────────────────────

  const handlePlayCard = useCallback(() => {
    if (!selectedCardId || !isMyTurn) return;

    const result = engine(state, {
      type: 'playCard',
      player: myName,
      cardId: selectedCardId,
      target: selectedTarget ?? undefined,
    });

    if (result.error) {
      console.warn('Play card error:', result.error);
      return;
    }

    setState(result.state);
    setSelectedCardId(null);
    setSelectedTarget(null);
    resetTimer();
  }, [state, selectedCardId, selectedTarget, isMyTurn, myName, resetTimer]);

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn || state.pending) return;

    // 如果需要弃牌且已选够，先弃牌
    if (needsDiscard && selectedForDiscard.size === discardMin) {
      const result = engine(state, {
        type: 'discard',
        player: myName,
        cardIds: [...selectedForDiscard],
      });
      if (!result.error) {
        setState(result.state);
        setSelectedForDiscard(new Set());
        setSelectedCardId(null);
        resetTimer();
      }
      return;
    }

    const result = engine(state, { type: 'endTurn', player: myName });
    if (result.error) {
      console.warn('End turn error:', result.error);
      return;
    }
    setState(result.state);
    setSelectedCardId(null);
    setSelectedTarget(null);
    setSelectedForDiscard(new Set());
    resetTimer();
  }, [state, isMyTurn, myName, needsDiscard, selectedForDiscard, discardMin, resetTimer]);

  const handleDiscard = useCallback(() => {
    if (!needsDiscard || selectedForDiscard.size !== discardMin) return;

    const result = engine(state, {
      type: 'discard',
      player: myName,
      cardIds: [...selectedForDiscard],
    });
    if (result.error) {
      console.warn('Discard error:', result.error);
      return;
    }
    setState(result.state);
    setSelectedForDiscard(new Set());
    setSelectedCardId(null);
    resetTimer();
  }, [state, needsDiscard, selectedForDiscard, discardMin, myName, resetTimer]);

  const respondToKill = useCallback((playDodge: boolean) => {
    if (state.pending?.type !== 'responseWindow') return;

    const cardId = playDodge
      ? me.hand.find(id => state.cardMap[id]?.name === '闪')
      : undefined;

    dispatch({
      type: 'respond',
      player: myName,
      cardId,
    });
  }, [state, myName, me.hand, dispatch]);

  /** 通用响应：响应杀/锦囊/决斗/AOE 等 responseWindow */
  const respond = useCallback((cardId?: string) => {
    if (state.pending?.type !== 'responseWindow') return;
    dispatch({ type: 'respond', player: myName, cardId });
  }, [state, myName, dispatch]);

  /** 选牌响应：顺手牵羊/过河拆桥选择目标手牌 */
  const selectTargetCard = useCallback((cardId: string) => {
    if (state.pending?.type !== 'selectCard') return;
    dispatch({ type: 'respond', player: myName, cardIds: [cardId] });
  }, [state, myName, dispatch]);

  const respondToDying = useCallback((saverName: string | null) => {
    if (state.pending?.type !== 'dyingWindow') return;

    if (!saverName) {
      // 无人救援
      dispatch({
        type: 'respond',
        player: state.pending.savers[state.pending.currentSaverIndex],
      });
      return;
    }

    const saver = getPlayer(state, saverName);
    const peachId = saver.hand.find(id => state.cardMap[id]?.name === '桃');

    dispatch({
      type: 'respond',
      player: saverName,
      cardId: peachId,
    });
  }, [state, dispatch]);

  const handleActivateSkill = useCallback((skillId: string, target?: string) => {
    if (!isMyTurn) return;

    const result = engine(state, {
      type: 'useSkill',
      player: myName,
      skillId,
      target,
    });
    if (result.error) {
      console.warn('Skill error:', result.error);
      return;
    }
    setState(result.state);
    resetTimer();
  }, [state, isMyTurn, myName, resetTimer]);

  // ── UI 操作 ─────────────────────────────────────────────────

  const switchPerspective = useCallback(() => {
    const idx = PLAYER_NAMES.indexOf(myName);
    const nextName = PLAYER_NAMES[(idx + 1) % PLAYER_NAMES.length];
    setMyName(nextName);
    setPlayerOrder(rotatePlayers(PLAYER_NAMES, nextName));
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [myName]);

  const goToCurrentPlayer = useCallback(() => {
    setMyName(state.currentPlayer);
    setPlayerOrder(rotatePlayers(PLAYER_NAMES, state.currentPlayer));
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [state.currentPlayer]);

  const toggleTimer = useCallback(() => setTimerPaused(prev => !prev), []);

  const handleSaveLog = useCallback(() => {
    saveState(state);
  }, [state]);

  const selectCard = useCallback((cardId: string | null) => {
    setSelectedCardId(cardId);
    setSelectedTarget(null);
    resetTimer();
  }, [resetTimer]);

  const toggleDiscardSelection = useCallback((cardId: string) => {
    setSelectedForDiscard(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else if (next.size < discardMax) next.add(cardId);
      return next;
    });
  }, [discardMax]);

  // 手牌列表：将 CardId 解析为 Card 对象
  const myHand: Card[] = me.hand
    .map(id => state.cardMap[id])
    .filter(Boolean);

  // 当前选中牌的索引（兼容 HandCards 组件）
  const selectedCardIndex = selectedCardId !== null
    ? me.hand.indexOf(selectedCardId)
    : null;

  // 可出手牌索引（兼容 HandCards 组件）
  const playableCardIds = new Set(playableCards.map(pc => pc.cardId));

  // 响应相关
  const hasDodge = me.hand.some(id => state.cardMap[id]?.name === '闪');

  // ── 玩家列表（兼容旧组件） ──────────────────────────────────
  // GameBoard 需要 orderedPlayers（V2 的 Record 转 array）
  const orderedPlayers = playerOrder
    .filter(name => state.players[name])
    .map(name => ({ name, player: state.players[name] }));

  return {
    // V2 状态
    state,
    me,
    myName,
    playerOrder,
    isMyTurn,

    // 选牌
    selectedCardId,
    selectedCardIndex,
    selectCard,
    selectedTarget,
    setSelectedTarget,

    // 出牌
    canPlay,
    validActions,
    playableCards,
    playableCardIds,
    needsTarget,
    validTargetList,
    handlePlayCard,

    // 结束回合
    handleEndTurn,

    // 弃牌
    needsDiscard,
    discardCount: discardMin,
    discardCards,
    selectedForDiscard,
    toggleDiscardSelection,
    handleDiscard,

    // 响应
    pendingPrompt,
    hasDodge,
    respondAction,
    respondToKill,
    respond,
    respondToDying,
    selectTargetCard,

    // 技能
    availableSkills,
    handleActivateSkill,

    // UI
    myHand,
    orderedPlayers,
    timerSeconds,
    timerPaused,
    toggleTimer,
    switchPerspective,
    goToCurrentPlayer,
    handleSaveLog,

    // 距离
    getDistance: (from: string, to: string) => getDistance(state, from, to),
  };
}
