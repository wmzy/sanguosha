// src/hooks/useDebugRoom.ts — DebugLobby UI 状态聚合 hook
//
// 把 DebugLobby 中可独立管理的 UI 状态（playerCount / error /
// debugRooms / operations / perspective / playerOrder / selectedCardId /
// selectedTarget / selectedForDiscard / selectedSkillCards）合并到
// useReducer 中。
//
// operations 由服务端在 events 消息中下发（debug 模式 = serverOps）。
// 客户端通过 appendOperations 累积、setOperations 全量替换。

import { useReducer, useCallback, useMemo } from 'react';
import type { GameState } from '../../engine/types';
import type { Operation } from '../../shared/log';
import type { RoomInfo } from '../../server/protocol';

export interface DebugUiState {
  playerCount: number;
  error: string | null;
  debugRooms: RoomInfo[];
  operations: Operation[];
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
  | { type: 'appendOperations'; ops: Operation[] }
  | { type: 'setOperations'; ops: Operation[] }
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
  appendOperations: (ops: Operation[]) => void;
  setOperations: (ops: Operation[]) => void;
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
  operations: [],
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
    case 'setOperations':
      return { ...state, operations: action.ops };
    case 'appendOperations':
      return { ...state, operations: [...state.operations, ...action.ops] };
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
  const appendOperations = useCallback((ops: Operation[]) => dispatch({ type: 'appendOperations', ops }), []);
  const setOperations = useCallback((ops: Operation[]) => dispatch({ type: 'setOperations', ops }), []);
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
      appendOperations,
      setOperations,
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
    [ui, setPlayerCount, setError, setDebugRooms, appendOperations, setOperations, setPerspective, setPlayerOrder, setSelectedCardId, setSelectedTarget, toggleSelectedForDiscard, clearSelectedForDiscard, toggleSelectedSkillCard, clearSelectedSkillCards, reset],
  );
}

export type { GameState };
