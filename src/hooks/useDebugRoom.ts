// src/hooks/useDebugRoom.ts — DebugLobby UI 状态聚合 hook
//
// 把 DebugLobby 中可独立管理的 UI 状态（playerCount / error /
// debugRooms / actionLog / perspective / playerOrder / selectedCardId /
// selectedTarget / selectedForDiscard / selectedSkillCards）合并到
// useReducer 中。
//
// actionLog 设计：
//   - 由客户端在 sendGameAction 时本地追加（不再依赖服务端每帧下发完整副本）。
//   - 重连后由 useDebugLobbyController 收到 initialView/debugGameState 时重新播种。
//   - clientSeq 是 UI 层流水号，与协议层 EventSeq 无关。

import { useReducer, useCallback, useMemo } from 'react';
import type { GameAction, GameState } from '../../engine/types';
import type { RoomInfo } from '../../server/protocol';

export interface ActionLogEntry {
  action: GameAction;
  /**
   * 客户端操作序号：从 1 开始本地累加，用于右侧操作流水的 seq 显示。
   * 与 events 消息的协议层 EventSeq 不同——这是 UI 层流水号，重连后归零。
   */
  clientSeq: number;
}

export interface DebugUiState {
  playerCount: number;
  error: string | null;
  debugRooms: RoomInfo[];
  actionLog: ActionLogEntry[];
  perspective: string;
  playerOrder: string[];
  selectedCardId: string | null;
  selectedTarget: string | null;
  selectedForDiscard: Set<string>;
  selectedSkillCards: Set<string>;
}

export type DebugUiAction =
  | { type: 'setPlayerCount'; n: number }
  | { type: 'setError'; err: string | null }
  | { type: 'setDebugRooms'; rooms: RoomInfo[] }
  | { type: 'setActionLog'; log: ActionLogEntry[] }
  | { type: 'appendAction'; action: GameAction }
  | { type: 'setPerspective'; p: string }
  | { type: 'setPlayerOrder'; order: string[] }
  | { type: 'setSelectedCardId'; id: string | null }
  | { type: 'setSelectedTarget'; t: string | null }
  | { type: 'toggleSelectedForDiscard'; id: string }
  | { type: 'clearSelectedForDiscard' }
  | { type: 'toggleSelectedSkillCard'; id: string }
  | { type: 'clearSelectedSkillCards' }
  | { type: 'reset' };

export type DebugUiSetter = {
  setPlayerCount: (n: number) => void;
  setError: (err: string | null) => void;
  setDebugRooms: (rooms: RoomInfo[]) => void;
  setActionLog: (log: ActionLogEntry[]) => void;
  appendAction: (action: GameAction) => void;
  setPerspective: (p: string) => void;
  setPlayerOrder: (order: string[]) => void;
  setSelectedCardId: (id: string | null) => void;
  setSelectedTarget: (t: string | null) => void;
  toggleSelectedForDiscard: (id: string) => void;
  clearSelectedForDiscard: () => void;
  toggleSelectedSkillCard: (id: string) => void;
  clearSelectedSkillCards: () => void;
  reset: () => void;
};

export type DebugUiController = {
  ui: DebugUiState;
} & DebugUiSetter;

const initialState: DebugUiState = {
  playerCount: 5,
  error: null,
  debugRooms: [],
  actionLog: [],
  perspective: '',
  playerOrder: [],
  selectedCardId: null,
  selectedTarget: null,
  selectedForDiscard: new Set(),
  selectedSkillCards: new Set(),
};

function reducer(state: DebugUiState, action: DebugUiAction): DebugUiState {
  switch (action.type) {
    case 'setPlayerCount':
      return { ...state, playerCount: action.n };
    case 'setError':
      return { ...state, error: action.err };
    case 'setDebugRooms':
      return { ...state, debugRooms: action.rooms };
    case 'setActionLog':
      return { ...state, actionLog: action.log };
    case 'appendAction': {
      const nextSeq = state.actionLog.length > 0
        ? state.actionLog[state.actionLog.length - 1].clientSeq + 1
        : 1;
      return { ...state, actionLog: [...state.actionLog, { action: action.action, clientSeq: nextSeq }] };
    }
    case 'setPerspective':
      return { ...state, perspective: action.p };
    case 'setPlayerOrder':
      return { ...state, playerOrder: action.order };
    case 'setSelectedCardId':
      return { ...state, selectedCardId: action.id };
    case 'setSelectedTarget':
      return { ...state, selectedTarget: action.t };
    case 'toggleSelectedForDiscard': {
      const next = new Set(state.selectedForDiscard);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedForDiscard: next };
    }
    case 'clearSelectedForDiscard':
      return { ...state, selectedForDiscard: new Set() };
    case 'toggleSelectedSkillCard': {
      const next = new Set(state.selectedSkillCards);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedSkillCards: next };
    }
    case 'clearSelectedSkillCards':
      return { ...state, selectedSkillCards: new Set() };
    case 'reset':
      return initialState;
  }
}

export function useDebugRoom(): DebugUiController {
  const [ui, dispatch] = useReducer(reducer, initialState);

  const setPlayerCount = useCallback((n: number) => dispatch({ type: 'setPlayerCount', n }), []);
  const setError = useCallback((err: string | null) => dispatch({ type: 'setError', err }), []);
  const setDebugRooms = useCallback((rooms: RoomInfo[]) => dispatch({ type: 'setDebugRooms', rooms }), []);
  const setActionLog = useCallback((log: ActionLogEntry[]) => dispatch({ type: 'setActionLog', log }), []);
  const appendAction = useCallback((action: GameAction) => dispatch({ type: 'appendAction', action }), []);
  const setPerspective = useCallback((p: string) => dispatch({ type: 'setPerspective', p }), []);
  const setPlayerOrder = useCallback((order: string[]) => dispatch({ type: 'setPlayerOrder', order }), []);
  const setSelectedCardId = useCallback((id: string | null) => dispatch({ type: 'setSelectedCardId', id }), []);
  const setSelectedTarget = useCallback((t: string | null) => dispatch({ type: 'setSelectedTarget', t }), []);
  const toggleSelectedForDiscard = useCallback((id: string) => dispatch({ type: 'toggleSelectedForDiscard', id }), []);
  const clearSelectedForDiscard = useCallback(() => dispatch({ type: 'clearSelectedForDiscard' }), []);
  const toggleSelectedSkillCard = useCallback((id: string) => dispatch({ type: 'toggleSelectedSkillCard', id }), []);
  const clearSelectedSkillCards = useCallback(() => dispatch({ type: 'clearSelectedSkillCards' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return useMemo(
    () => ({
      ui,
      setPlayerCount,
      setError,
      setDebugRooms,
      setActionLog,
      appendAction,
      setPerspective,
      setPlayerOrder,
      setSelectedCardId,
      setSelectedTarget,
      toggleSelectedForDiscard,
      clearSelectedForDiscard,
      toggleSelectedSkillCard,
      clearSelectedSkillCards,
      reset,
    }),
    [ui, setPlayerCount, setError, setDebugRooms, setActionLog, appendAction, setPerspective, setPlayerOrder, setSelectedCardId, setSelectedTarget, toggleSelectedForDiscard, clearSelectedForDiscard, toggleSelectedSkillCard, clearSelectedSkillCards, reset],
  );
}

export type { GameState };
