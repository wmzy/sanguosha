import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { GameBoard } from './GameBoard';
import type { GameBoardData } from './GameBoard';
import { computeValidActions } from '../../engine/v2/validate';
import { getDistance } from '../../engine/v2/distance';
import { getPlayer } from '../../engine/v2/state';
import type { GameState, GameAction, ValidAction, PlayerState } from '../../engine/v2/types';
import type { Card } from '../../shared/types';
import { saveState } from '../utils/logFile';
import { colors, styles } from '../theme';

function rotatePlayers(names: string[], startName: string): string[] {
  const idx = names.indexOf(startName);
  if (idx <= 0) return names;
  return [...names.slice(idx), ...names.slice(0, idx)];
}

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

function extractPendingPrompt(state: GameState): PendingPrompt | null {
  const pending = state.pending;
  if (!pending) return null;
  switch (pending.type) {
    case 'responseWindow':
      switch (pending.window.type) {
        case 'killResponse':
          return { type: 'killResponse', text: `${pending.window.attacker} 对你使用了杀！`, responder: pending.window.defender, attacker: pending.window.attacker, validCards: pending.window.validCards };
        case 'aoeResponse':
          return { type: 'aoeResponse', text: pending.window.requiredCard === '杀' ? '南蛮入侵：请出杀响应' : '万箭齐发：请出闪响应', responder: pending.window.defender, attacker: pending.window.attacker, validCards: pending.window.validCards, requiredCard: pending.window.requiredCard };
        case 'dyingResponse':
          return { type: 'dyingResponse', text: `${pending.window.defender} 濒死！`, responder: pending.window.defender, validCards: pending.window.validCards };
        case 'duelResponse':
          return { type: 'duelResponse', text: '请出杀响应决斗', responder: pending.window.defender, validCards: pending.window.validCards };
        case 'trickResponse': {
          const passedResponders = pending.window.passedResponders ?? [];
          const activeResponders = pending.window.responders?.filter(p => !passedResponders.includes(p));
          if (activeResponders && activeResponders.length > 0) {
            return { type: 'trickResponse', text: '请响应锦囊', responders: activeResponders, responder: pending.window.defender, validCards: pending.window.validCards };
          }
          return { type: 'trickResponse', text: '请响应锦囊', responder: pending.window.defender, validCards: pending.window.validCards };
        }
      }
      break;
    case 'discardPhase':
      return { type: 'discardPhase', text: `请弃掉 ${pending.min}~${pending.max} 张牌` };
    case 'dyingWindow':
      return { type: 'dyingWindow', text: `${pending.dyingPlayer} 濒死！需要桃来救援`, dyingPlayer: pending.dyingPlayer, savers: pending.savers, currentSaver: pending.savers[pending.currentSaverIndex] };
    case 'skillPrompt':
      return { type: 'skillPrompt', text: pending.prompt.text };
    case 'selectCard':
      return { type: 'selectCard', text: pending.mode === 'steal' ? '顺手牵羊：选择要获得的牌' : '过河拆桥：选择要弃掉的牌', targetPlayer: pending.target, targetCardIds: pending.cardIds, selectMode: pending.mode };
    case 'harvestSelection':
      return { type: 'harvestSelection', text: `五谷丰登：${pending.pickOrder[pending.currentPickerIndex]} 选牌`, responder: pending.pickOrder[pending.currentPickerIndex], targetCardIds: pending.revealedCards, targetPlayer: pending.pickOrder[pending.currentPickerIndex] };
  }
  return null;
}

function _getSingleActivePlayer(state: GameState): string | null {
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
      case 'discardPhase': return pending.player;
      case 'dyingWindow': return pending.savers[pending.currentSaverIndex];
      case 'selectCard': return pending.player;
      case 'harvestSelection': return pending.pickOrder[pending.currentPickerIndex];
      case 'skillPrompt': return pending.player;
      default: return null;
    }
  }
  if (state.phase === '出牌') return state.currentPlayer;
  return null;
}

const defaultMe: PlayerState = {
  info: { name: '', characterId: '', role: '反贼', alive: false, gender: '男', faction: '群' },
  health: 0, maxHealth: 0, hand: [], equipment: {}, pendingTricks: [], vars: {}, tags: [],
};

interface DebugLobbyProps {
  onExit: () => void;
}

export function DebugLobby({ onExit }: DebugLobbyProps) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = useMemo(() => `${wsProtocol}//${window.location.host}/ws`, [wsProtocol]);
  const { connected, lastMessage, send, connect } = useWebSocket(wsUrl);

  const [playerCount, setPlayerCount] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const [state, setState] = useState<GameState | null>(null);
  const [perspective, setPerspective] = useState('');
  const [playerOrder, setPlayerOrder] = useState<string[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'debugGameState') {
      setState(lastMessage.state);
      if (!perspective && lastMessage.state.currentPlayer) {
        setPerspective(lastMessage.state.currentPlayer);
        setPlayerOrder(rotatePlayers(lastMessage.state.playerOrder, lastMessage.state.currentPlayer));
      }
    }
    if (lastMessage.type === 'error') {
      setError(lastMessage.message);
      setTimeout(() => setError(null), 3000);
    }
  }, [lastMessage, perspective]);

  const handleCreateDebugRoom = useCallback(() => {
    send({ type: 'create_debug_room', playerCount });
  }, [playerCount, send]);

  const handleDeleteRoom = useCallback(() => {
    send({ type: 'delete_room' });
    setState(null);
    setPerspective('');
    setPlayerOrder([]);
    setSelectedCardId(null);
    setSelectedTarget(null);
    setSelectedForDiscard(new Set());
  }, [send]);

  const handleExit = useCallback(() => {
    handleDeleteRoom();
    onExit();
  }, [handleDeleteRoom, onExit]);

  if (state) {
    const myName = perspective;
    const me: PlayerState = state.players[myName] ?? defaultMe;
    const isMyTurn = state.currentPlayer === myName;

    const validActions: ValidAction[] = computeValidActions(state, myName);
    const playCardAction = validActions.find(a => a.type === 'playCard');
    const playableCards = playCardAction?.cards ?? [];
    const respondAction = validActions.find(a => a.type === 'respond');
    const discardAction = validActions.find(a => a.type === 'discard');
    const useSkillAction = validActions.find(a => a.type === 'useSkill');
    const availableSkills = useSkillAction?.skills ?? [];

    const selectedCardEntry = selectedCardId !== null ? playableCards.find(pc => pc.cardId === selectedCardId) : undefined;
    const needsTarget = selectedCardId !== null && !!selectedCardEntry && selectedCardEntry.targets.length > 0;
    const validTargetList = selectedCardEntry?.targets ?? [];
    const canPlay = selectedCardId !== null && isMyTurn && state.phase === '出牌' && !state.pending && !!selectedCardEntry;
    const needsDiscard = discardAction != null;
    const discardMin = discardAction?.min ?? 0;
    const discardMax = discardAction?.max ?? 0;
    const pendingPrompt = extractPendingPrompt(state);
    const hasDodge = (respondAction?.cards?.length ?? 0) > 0;
    const playableCardIds = new Set(playableCards.map(pc => pc.cardId));
    const myHand: Card[] = me.hand.map(id => state.cardMap[id]).filter(Boolean);
    const selectedCardIndex = selectedCardId !== null ? me.hand.indexOf(selectedCardId) : null;
    const orderedPlayers = playerOrder.filter(name => state.players[name]).map(name => ({ name, player: state.players[name] }));

    const dispatch = (action: GameAction) => {
      send({ type: 'action', action });
    };

    const gameData: GameBoardData = {
      state,
      me,
      myName,
      playerOrder,
      isMyTurn,
      selectedCardId,
      selectedCardIndex,
      selectCard: (cardId: string | null) => {
        setSelectedCardId(cardId);
        setSelectedTarget(null);
      },
      selectedTarget,
      setSelectedTarget,
      canPlay,
      validActions,
      playableCards,
      playableCardIds,
      needsTarget,
      validTargetList,
      handlePlayCard: () => {
        if (!selectedCardId || !isMyTurn) return;
        dispatch({ type: 'playCard', player: myName, cardId: selectedCardId, target: selectedTarget ?? undefined });
        setSelectedCardId(null);
        setSelectedTarget(null);
      },
      handleEndTurn: () => {
        if (!isMyTurn) return;
        if (needsDiscard) {
          if (selectedForDiscard.size === discardMin) {
            dispatch({ type: 'discard', player: myName, cardIds: [...selectedForDiscard] });
            setSelectedForDiscard(new Set());
            setSelectedCardId(null);
          }
          return;
        }
        if (state.pending) return;
        dispatch({ type: 'endTurn', player: myName });
        setSelectedCardId(null);
        setSelectedTarget(null);
        setSelectedForDiscard(new Set());
      },
      needsDiscard,
      discardCount: discardMin,
      discardCards: discardAction?.cards ?? [],
      selectedForDiscard,
      toggleDiscardSelection: (cardId: string) => {
        setSelectedForDiscard(prev => {
          const next = new Set(prev);
          if (next.has(cardId)) next.delete(cardId);
          else if (next.size < discardMax) next.add(cardId);
          return next;
        });
      },
      handleDiscard: () => {
        if (!needsDiscard || selectedForDiscard.size !== discardMin) return;
        dispatch({ type: 'discard', player: myName, cardIds: [...selectedForDiscard] });
        setSelectedForDiscard(new Set());
        setSelectedCardId(null);
      },
      pendingPrompt,
      hasDodge,
      respondAction,
      respondToKill: (playDodge: boolean) => {
        if (state.pending?.type !== 'responseWindow' || state.pending.window.defender !== myName) return;
        const respondCards = respondAction?.cards ?? [];
        const cardId = playDodge ? respondCards[0] : undefined;
        dispatch({ type: 'respond', player: myName, cardId });
      },
      respond: (cardId?: string) => {
        if (state.pending?.type !== 'responseWindow') return;
        if (state.pending.window.type === 'trickResponse' && state.pending.window.responders) {
          const passed = state.pending.window.passedResponders ?? [];
          const active = state.pending.window.responders.filter(p => !passed.includes(p));
          if (!active.includes(myName)) return;
        } else {
          if (state.pending.window.defender !== myName) return;
        }
        dispatch({ type: 'respond', player: myName, cardId });
      },
      respondToDying: (saverName: string | null) => {
        if (state.pending?.type !== 'dyingWindow') return;
        const currentSaver = state.pending.savers[state.pending.currentSaverIndex];
        if (!saverName) {
          dispatch({ type: 'respond', player: currentSaver });
          return;
        }
        if (saverName !== currentSaver) return;
        const saver = getPlayer(state, saverName);
        const peachId = saver.hand.find(id => state.cardMap[id]?.name === '桃');
        dispatch({ type: 'respond', player: saverName, cardId: peachId });
      },
      selectTargetCard: (cardId: string) => {
        if (state.pending?.type !== 'selectCard') return;
        dispatch({ type: 'respond', player: myName, cardIds: [cardId] });
      },
      selectHarvestCard: (cardId: string) => {
        if (state.pending?.type !== 'harvestSelection') return;
        const currentPicker = state.pending.pickOrder[state.pending.currentPickerIndex];
        if (currentPicker !== myName) return;
        dispatch({ type: 'respond', player: myName, cardId });
      },
      availableSkills,
      handleActivateSkill: (skillId: string, target?: string) => {
        if (!isMyTurn) return;
        dispatch({ type: 'useSkill', player: myName, skillId, target });
      },
      myHand,
      orderedPlayers,
      switchPerspective: () => {
        const idx = state.playerOrder.indexOf(myName);
        const nextName = state.playerOrder[(idx + 1) % state.playerOrder.length];
        setPerspective(nextName);
        setPlayerOrder(rotatePlayers(state.playerOrder, nextName));
        setSelectedCardId(null);
        setSelectedTarget(null);
      },
      setPerspective: (playerName: string) => {
        setPerspective(playerName);
        setPlayerOrder(rotatePlayers(state.playerOrder, playerName));
        setSelectedCardId(null);
        setSelectedTarget(null);
      },
      goToCurrentPlayer: () => {
        setPerspective(state.currentPlayer);
        setPlayerOrder(rotatePlayers(state.playerOrder, state.currentPlayer));
        setSelectedCardId(null);
        setSelectedTarget(null);
      },
      handleSaveLog: () => {
        saveState(state);
      },
      toggleAutoSkipWuxie: () => {
        dispatch({ type: 'toggleAutoSkipWuxie' });
      },
      getDistance: (from: string, to: string) => getDistance(state, from, to),
    };

    return (
      <div>
        <nav style={navStyle}>
          <button onClick={handleExit} style={navLinkStyle}>← 退出</button>
          <button onClick={handleDeleteRoom} style={navLinkStyle}>删除房间</button>
          <span style={{ color: colors.text.muted }}>调试游戏</span>
        </nav>
        <GameBoard data={gameData} />
      </div>
    );
  }

  return (
    <div style={styles.page(40)}>
      <nav style={navStyle}>
        <button onClick={onExit} style={navLinkStyle}>← 返回</button>
        <span style={{ color: colors.text.muted }}>调试游戏</span>
      </nav>
      <div style={{ marginTop: 40 }}>
        <h1 style={{ textAlign: 'center', marginBottom: 40 }}>创建调试房间</h1>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ backgroundColor: colors.bg.panel, borderRadius: 12, padding: 30, minWidth: 320, maxWidth: 400 }}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 5, fontSize: 14 }}>玩家人数</label>
              <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))} style={styles.input()}>
                <option value={2}>2人</option>
                <option value={3}>3人</option>
                <option value={4}>4人</option>
                <option value={5}>5人</option>
                <option value={6}>6人</option>
                <option value={7}>7人</option>
                <option value={8}>8人</option>
              </select>
            </div>
            <button
              onClick={handleCreateDebugRoom}
              disabled={!connected}
              style={{
                width: '100%', padding: '12px',
                backgroundColor: connected ? colors.accent.orange : colors.disabled,
                color: colors.white, border: 'none', borderRadius: 6,
                cursor: connected ? 'pointer' : 'not-allowed',
                fontSize: 16, fontWeight: 'bold',
              }}
            >
              创建调试房间
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 30, color: connected ? colors.accent.green : colors.accent.red }}>
          {connected ? '已连接到服务器' : '未连接，请检查服务器是否启动'}
        </div>
      </div>
      {error && <div style={styles.errorToast()}>{error}</div>}
    </div>
  );
}

const navStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 16,
  padding: '12px 20px', backgroundColor: colors.bg.nav,
  borderBottom: `1px solid ${colors.bg.input}`,
};

const navLinkStyle: React.CSSProperties = {
  color: colors.accent.blue, textDecoration: 'none', fontSize: 14,
  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
};
