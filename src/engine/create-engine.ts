// src/engine/create-engine.ts
import type { ClientMessage, GameState, GameView, SettlementFrame } from './types';
import { buildView } from './view/buildView';

export interface EngineInstance {
  dispatch(state: GameState, message: ClientMessage): GameState;
  buildView(state: GameState, viewer: number): GameView;
}

export function createEngine(): EngineInstance {
  return {
    dispatch(state, _message) {
      // 占位:无 action 路由,Skill 未注册
      // 后续 PR 替换为 路由 → registerAction 查表 → execute
      return state;
    },
    buildView,
  };
}