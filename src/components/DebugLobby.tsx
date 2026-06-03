import { useState, useReducer, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { GameBoard } from './GameBoard';
import type { GameBoardData, PlayerEntry } from './GameBoard';
import { computeValidActions } from '../../engine/validate';
import { getDistance } from '../../engine/distance';
import { getPlayer } from '../../engine/state';
import { buildPlayerView } from '../../engine/view/buildView';
import { reduceGameState } from '../../engine/view/reducer';
import type { SelfView } from '../../engine/view/types';
import type { GameState, GameAction, ValidAction, PlayerState, PromptOption, Json, ServerEvent } from '../../engine/types';
import type { Card } from '../../shared/types';
import { saveState } from '../utils/logFile';
import { colors, styles } from '../theme';
import type { ServerMessage } from '../../server/protocol';

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
  options?: PromptOption[];
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
      return { type: 'skillPrompt', text: pending.prompt.text, options: pending.prompt.options };
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
      case 'playPhase': return pending.player;
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
  initialRoomId?: string;
}

const STORAGE_KEY = 'debug_session';

function storeSession(roomId: string, playerId: string) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId, playerId }));
}

function loadSession(): { roomId: string; playerId: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

type DebugAction =
  | { type: 'reset'; state: GameState }
  | { type: 'applyEvents'; events: ServerEvent[] };

function debugReducer(state: GameState | null, action: DebugAction): GameState | null {
  if (action.type === 'reset') {
    return action.state;
  }
  if (action.type === 'applyEvents') {
    if (!state) return state;
    if (action.events.length === 0) return state;
    return reduceGameState(state, action.events);
  }
  return state;
}

export function DebugLobby({ onExit: _onExit, initialRoomId }: DebugLobbyProps) {
  const navigate = useNavigate();
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = useMemo(() => `${wsProtocol}//${window.location.host}/ws`, [wsProtocol]);
  const { connected, send, onMessage, connect } = useWebSocket(wsUrl);

  const [playerCount, setPlayerCount] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(debugReducer, null as GameState | null);
  const [perspective, setPerspective] = useState('');
  const [playerOrder, setPlayerOrder] = useState<string[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());
  const hasRequestedRef = useRef(false);
  const stateRef = useRef<GameState | null>(null);
  const [selectedSkillCards, setSelectedSkillCards] = useState<Set<string>>(new Set());

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!connected || hasRequestedRef.current) return;
    if (!initialRoomId) return;
    const session = loadSession();
    if (session?.roomId === initialRoomId) {
      hasRequestedRef.current = true;
      send({ type: 'reconnect', playerId: session.playerId });
    } else {
      hasRequestedRef.current = true;
      send({ type: 'join_debug_room', roomId: initialRoomId });
    }
  }, [connected, initialRoomId, send]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const unsubscribe = onMessage((msg: ServerMessage) => {
      if (msg.type === 'debugGameState') {
        dispatch({ type: 'reset', state: msg.state });
        if (!perspective && msg.state.currentPlayer) {
          setPerspective(msg.state.currentPlayer);
          setPlayerOrder(rotatePlayers(msg.state.playerOrder, msg.state.currentPlayer));
        }
      } else if (msg.type === 'events') {
        dispatch({ type: 'applyEvents', events: msg.events });
      } else if (msg.type === 'room_joined') {
        storeSession(msg.roomId, msg.playerId);
        window.history.replaceState(null, '', `/debug/${msg.roomId}`);
      } else if (msg.type === 'error') {
        if (initialRoomId && !stateRef.current) {
          clearSession();
          navigate('/debug', { replace: true });
        } else {
          setError(msg.message);
          setTimeout(() => setError(null), 3000);
        }
      }
    });
    return unsubscribe;
  }, [onMessage, perspective, initialRoomId, navigate]);

  useEffect(() => {
    if (!state) return;
    const active = _getSingleActivePlayer(state);
    if (active && active !== perspective) {
      setPerspective(active);
      setPlayerOrder(rotatePlayers(state.playerOrder, active));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleCreateDebugRoom = useCallback(async () => {
    try {
      const res = await fetch('/api/debug-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '创建失败');
        setTimeout(() => setError(null), 3000);
        return;
      }
      navigate(`/debug/${data.roomId}`, { replace: true });
    } catch {
      setError('网络错误');
      setTimeout(() => setError(null), 3000);
    }
  }, [playerCount, navigate]);

  const handleDeleteRoom = useCallback(() => {
    send({ type: 'delete_room' });
    clearSession();
    navigate('/');
    setPerspective('');
    setPlayerOrder([]);
    setSelectedCardId(null);
    setSelectedTarget(null);
    setSelectedForDiscard(new Set());
  }, [send]);

  const handleExit = useCallback(() => {
    handleDeleteRoom();
    navigate('/');
  }, [handleDeleteRoom, navigate]);

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
    const canPlay = selectedCardId !== null && isMyTurn && state.phase === '出牌' && (!state.pending || state.pending.type === 'playPhase') && !!selectedCardEntry;
    const needsDiscard = discardAction != null;
    const discardMin = discardAction?.min ?? 0;
    const discardMax = discardAction?.max ?? 0;
    const pendingPrompt = extractPendingPrompt(state);
    const hasDodge = (respondAction?.cards?.length ?? 0) > 0;
    const playableCardIds = new Set(playableCards.map(pc => pc.cardId));
    const myHand: Card[] = me.hand.map(id => state.cardMap[id]).filter(Boolean);
    const selectedCardIndex = selectedCardId !== null ? me.hand.indexOf(selectedCardId) : null;

    // 为每个玩家构建 PlayerView（debug 模式：所有玩家都看得到完整 SelfView）
    const playerEntries: PlayerEntry[] = playerOrder
      .filter(name => state.players[name])
      .map((name): PlayerEntry => {
        const player = state.players[name];
        const selfView: SelfView = buildPlayerView(state, name).self;
        return {
          name,
          panelData: { kind: 'self', data: selfView },
          characterId: player.info.characterId,
          role: player.info.role,
          alive: player.info.alive,
        };
      });

    const dispatch = (action: GameAction) => {
      send({ type: 'action', action });
    };

    const gameData: GameBoardData = {
      state,
      cardMap: state.cardMap,
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
        if (state.pending && state.pending.type !== 'playPhase') return;
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
      selectedSkillCards,
      toggleSkillCardSelection: (cardId: string) => {
        setSelectedSkillCards(prev => {
          const next = new Set(prev);
          if (next.has(cardId)) next.delete(cardId);
          else next.add(cardId);
          return next;
        });
      },
      handleSkillChoice: (choice: Json) => {
        if (state.pending?.type !== 'skillPrompt') return;
        dispatch({ type: 'skillChoice', player: myName, choice });
        setSelectedSkillCards(new Set());
      },
      myHand,
      orderedPlayers: playerEntries,
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
        const target = _getSingleActivePlayer(state) ?? state.currentPlayer;
        setPerspective(target);
        setPlayerOrder(rotatePlayers(state.playerOrder, target));
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
      pending: state.pending,
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
        <button onClick={() => navigate('/')} style={navLinkStyle}>← 返回</button>
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
