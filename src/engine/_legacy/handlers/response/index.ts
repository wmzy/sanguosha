// @ts-nocheck
// engine/handlers/response/index.ts — 响应窗口处理入口
//
// 统一 re-export 各种 response handlers，并提供 resolveResponse 派发器。
// 旧 `engine/handlers/response-handlers.ts` 通过 re-export 此模块保持向后兼容。

import type { GameState, GameAction, EngineResult, PendingResponseWindow } from '../../types';
import { resolveKillResponse } from './kill';
import { resolveAoeResponse } from './aoe';
import { resolveTrickResponse, createConcurrentTrickResponse, executeTrickEffect } from './trick';
import { resolveDuelResponse } from './duel';
import { resolveDyingResponse } from './dying';
import { resolveSelectCard } from './select';

export {
  resolveKillResponse,
  resolveAoeResponse,
  resolveTrickResponse,
  resolveDuelResponse,
  resolveDyingResponse,
  resolveSelectCard,
  createConcurrentTrickResponse,
  executeTrickEffect,
};

export { executeAoeResume, startAoeTargetWuxie } from './aoe';

export function resolveResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  switch (pending.window.type) {
    case 'killResponse':
      return resolveKillResponse(state, action, pending);
    case 'aoeResponse':
      return resolveAoeResponse(state, action, pending);
    case 'trickResponse':
      return resolveTrickResponse(state, action, pending);
    case 'duelResponse':
      return resolveDuelResponse(state, action, pending);
    case 'dyingResponse':
      return resolveDyingResponse(state, action, pending);
  }
}
