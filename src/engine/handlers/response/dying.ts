// engine/handlers/response/dying.ts — 濒死窗口的 respond 路径

import type { GameState, GameAction, EngineResult, PendingResponseWindow } from '../../types';

export function resolveDyingResponse(
  _state: GameState,
  _action: GameAction,
  _pending: PendingResponseWindow,
): EngineResult {
  return {
    state: _state,
    events: [],
    error: '濒死响应不应通过此路径处理',
  };
}
