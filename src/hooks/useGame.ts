import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { engine } from '../../engine/v2/engine';
import { createInitialState, getPlayer } from '../../engine/v2/state';
import { computeValidActions } from '../../engine/v2/validate';
import { getDistance } from '../../engine/v2/distance';
import type { GameState as V2GameState, GameAction, ValidAction } from '../../engine/v2/types';
import type { Card, Role } from '../../shared/types';
import { 曹操, 刘备, 孙权, 诸葛亮, 司马懿 } from '../../shared/characters';
import { saveState } from '../utils/logFile';

const CHARACTERS = [曹操, 刘备, 孙权, 诸葛亮, 司马懿];
const PLAYER_NAMES = CHARACTERS.map(c => c.name);
const PLAYER_ROLES: Role[] = ['主公', '反贼', '忠臣', '内奸', '反贼'];

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
  responders?: string[];
  attacker?: string;
  validCards?: string[];
  dyingPlayer?: string;
  savers?: string[];
  currentSaver?: string;
  requiredCard?: string;
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
        case 'trickResponse': {
          const passedResponders = pending.window.passedResponders ?? [];
          const activeResponders = pending.window.responders
            ?.filter(p => !passedResponders.includes(p));
          if (activeResponders && activeResponders.length > 0) {
            return {
              type: 'trickResponse',
              text: '请响应锦囊',
              responders: activeResponders,
              responder: pending.window.defender,
              validCards: pending.window.validCards,
            };
          }
          return {
            type: 'trickResponse',
            text: '请响应锦囊',
            responder: pending.window.defender,
            validCards: pending.window.validCards,
          };
        }
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
        currentSaver: pending.savers[pending.currentSaverIndex],
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
    case 'harvestSelection':
      return {
        type: 'harvestSelection',
        text: `五谷丰登：${pending.pickOrder[pending.currentPickerIndex]} 选牌`,
        responder: pending.pickOrder[pending.currentPickerIndex],
        targetCardIds: pending.revealedCards,
        targetPlayer: pending.pickOrder[pending.currentPickerIndex],
      };
  }
  return null;
}

/** 获取当前唯一需要行动的玩家，如果有多个则返回 null */
function _getSingleActivePlayer(state: V2GameState): string | null {
  const pending = state.pending;
  if (pending) {
    switch (pending.type) {
      case 'responseWindow': {
        if (pending.window.type === 'trickResponse' && pending.window.responders) {
          const passed = pending.window.passedResponders ?? [];
          const active = pending.window.responders.filter((p: string) => !passed.includes(p));
          return active.length === 1 ? active[0] : null;
        }
        return pending.window.defender;
      }
      case 'discardPhase':
        return pending.player;
      case 'dyingWindow':
        return pending.savers[pending.currentSaverIndex];
      case 'selectCard':
        return pending.player;
      case 'harvestSelection':
        return pending.pickOrder[pending.currentPickerIndex];
      case 'skillPrompt':
        return pending.player;
      default:
        return null;
    }
  }
  // 无 pending 时，出牌阶段的当前玩家
  if (state.phase === '出牌') return state.currentPlayer;
  return null;
}

export function useGame() {
  // ── V2 引擎状态 ─────────────────────────────────────────────
  const [state, setState] = useState<V2GameState>(() => {
    const config = {
      players: CHARACTERS.map((c, i) => ({
        name: c.name,
        characterId: c.name,
        role: PLAYER_ROLES[i],
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

  const stateRef = useRef(state);
  stateRef.current = state;

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

  const setPerspective = useCallback((playerName: string) => {
    setMyName(playerName);
    setPlayerOrder(rotatePlayers(PLAYER_NAMES, playerName));
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, []);

  // ── 超时自动执行（引擎 deadline 驱动，调试模式无服务端） ─────
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const pending = state.pending;
    if (!pending || state.meta.status !== '进行中') return;
    const delay = Math.max(0, pending.deadline - Date.now());
    timeoutRef.current = setTimeout(() => {
      const current = stateRef.current;
      if (!current.pending) return;
      const result = engine(current, current.pending.onTimeout);
      if (!result.error) {
        setState(result.state);
        setSelectedForDiscard(new Set());
        setSelectedCardId(null);
      }
    }, delay);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [state.pending?.deadline, state.pending?.type, state.meta.status, state]);

  // ── 自动切换到需要操作的玩家 ──────────────────────────────
  useEffect(() => {
    const active = _getSingleActivePlayer(state);
    if (active && active !== myName) {
      setMyName(active);
      setPlayerOrder(rotatePlayers(PLAYER_NAMES, active));
      setSelectedCardId(null);
      setSelectedTarget(null);
    }
    // 故意不包含 myName：只在 state 变化时触发，手动切换视角不会触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── dispatch helper ─────────────────────────────────────────
  const dispatch = useCallback((action: GameAction) => {
    const result = engine(state, action);
    if (result.error) return;
    setState(result.state);
  }, [state]);

  // 自动跳过无懈可击：当玩家手中无无懈可击时自动不出
  const autoSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoSkipTimerRef.current) {
      clearTimeout(autoSkipTimerRef.current);
      autoSkipTimerRef.current = null;
    }
    if (!state.meta.autoSkipWuxie) return;
    const pending = state.pending;
    if (pending?.type !== 'responseWindow' || pending.window.type !== 'trickResponse') return;
    const window_ = pending.window;
    const passed = window_.passedResponders ?? [];
    const active = (window_.responders ?? []).filter(p => !passed.includes(p));
    if (!active.includes(myName)) return;
    const myPlayer = getPlayer(state, myName);
    const hasWuxie = myPlayer.hand.some(id => state.cardMap[id]?.name === '无懈可击');
    if (hasWuxie) return;
    const delay = 500 + Math.random() * 1500; // 500-2000ms 随机延迟
    autoSkipTimerRef.current = setTimeout(() => {
      const current = stateRef.current;
      if (current.pending?.type !== 'responseWindow') return;
      const curWindow = current.pending.window;
      if (curWindow.type !== 'trickResponse') return;
      const curPassed = curWindow.passedResponders ?? [];
      const curActive = (curWindow.responders ?? []).filter(p => !curPassed.includes(p));
      if (!curActive.includes(myName)) return;
      dispatch({ type: 'respond', player: myName });
    }, delay);
    return () => {
      if (autoSkipTimerRef.current) {
        clearTimeout(autoSkipTimerRef.current);
        autoSkipTimerRef.current = null;
      }
    };
  }, [state.pending, state.meta.autoSkipWuxie, myName, dispatch, state]);

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
  }, [state, selectedCardId, selectedTarget, isMyTurn, myName]);

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn) return;

    // 如果需要弃牌且已选够，先弃牌
    if (needsDiscard) {
      if (selectedForDiscard.size === discardMin) {
        const result = engine(state, {
          type: 'discard',
          player: myName,
          cardIds: [...selectedForDiscard],
        });
        if (!result.error) {
          setState(result.state);
          setSelectedForDiscard(new Set());
          setSelectedCardId(null);
        }
      }
      return;
    }

    if (state.pending) return;

    const result = engine(state, { type: 'endTurn', player: myName });
    if (result.error) {
      console.warn('End turn error:', result.error);
      return;
    }
    setState(result.state);
    setSelectedCardId(null);
    setSelectedTarget(null);
    setSelectedForDiscard(new Set());
  }, [state, isMyTurn, myName, needsDiscard, selectedForDiscard, discardMin]);

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
  }, [state, needsDiscard, selectedForDiscard, discardMin, myName]);

  const respondToKill = useCallback((playDodge: boolean) => {
    if (state.pending?.type !== 'responseWindow') return;
    if (state.pending.window.defender !== myName) return;

    const cardId = playDodge ? respondAction?.cards?.[0] : undefined;

    dispatch({
      type: 'respond',
      player: myName,
      cardId,
    });
  }, [state, myName, respondAction, dispatch]);

  /** 通用响应：响应杀/锦囊/决斗/AOE 等 responseWindow */
  const respond = useCallback((cardId?: string) => {
    if (state.pending?.type !== 'responseWindow') return;
    // 并发 trickResponse：任意 responder 都可以响应
    if (state.pending.window.type === 'trickResponse' && state.pending.window.responders) {
      const passed = state.pending.window.passedResponders ?? [];
      const active = state.pending.window.responders.filter(p => !passed.includes(p));
      if (!active.includes(myName)) return;
    } else {
      if (state.pending.window.defender !== myName) return;
    }
    dispatch({ type: 'respond', player: myName, cardId });
  }, [state, myName, dispatch]);

  /** 选牌响应：顺手牵羊/过河拆桥选择目标手牌 */
  const selectTargetCard = useCallback((cardId: string) => {
    if (state.pending?.type !== 'selectCard') return;
    dispatch({ type: 'respond', player: myName, cardIds: [cardId] });
  }, [state, myName, dispatch]);

  /** 五谷丰登选牌：从翻出的牌中选择一张 */
  const selectHarvestCard = useCallback((cardId: string) => {
    if (state.pending?.type !== 'harvestSelection') return;
    const currentPicker = state.pending.pickOrder[state.pending.currentPickerIndex];
    if (currentPicker !== myName) return;
    dispatch({ type: 'respond', player: myName, cardId });
  }, [state, myName, dispatch]);

  const respondToDying = useCallback((saverName: string | null) => {
    if (state.pending?.type !== 'dyingWindow') return;

    const currentSaver = state.pending.savers[state.pending.currentSaverIndex];

    if (!saverName) {
      dispatch({
        type: 'respond',
        player: currentSaver,
      });
      return;
    }

    if (saverName !== currentSaver) return;

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
  }, [state, isMyTurn, myName]);

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
    const target = _getSingleActivePlayer(state) ?? state.currentPlayer;
    setMyName(target);
    setPlayerOrder(rotatePlayers(PLAYER_NAMES, target));
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [state]);

  const handleSaveLog = useCallback(() => {
    saveState(state);
  }, [state]);

  const selectCard = useCallback((cardId: string | null) => {
    setSelectedCardId(cardId);
    setSelectedTarget(null);
  }, []);

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
  const hasDodge = (respondAction?.cards?.length ?? 0) > 0;

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
    selectHarvestCard,

    // 技能
    availableSkills,
    handleActivateSkill,

    // UI
    myHand,
    orderedPlayers,
    switchPerspective,
    setPerspective,
    goToCurrentPlayer,
    handleSaveLog,

    // 调试
    toggleAutoSkipWuxie: useCallback(() => dispatch({ type: 'toggleAutoSkipWuxie' }), [dispatch]),

    // 距离
    getDistance: (from: string, to: string) => getDistance(state, from, to),
  };
}
