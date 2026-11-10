import type { GameState, GameView } from '../types';
import { 锦囊牌列表 } from '../data/card-defs';
import { XIANZHEN_WIN_TARGET_VIEW_KEY } from './vars-keys';

const ordinaryTricks = new Set(锦囊牌列表.map((card) => card.name)
  .filter((name) => !['乐不思蜀', '兵粮寸断', '闪电', '无懈可击', '借刀杀人'].includes(name)));

export function allowsExtraTarget(cardName: string): boolean {
  return cardName === '杀' || ordinaryTricks.has(cardName);
}

export function extraCardTarget(state: GameState, source: number, cardName: string): number | undefined {
  if (!allowsExtraTarget(cardName) || !state.players[source]?.skills.includes('界陷阵')) return;
  const target = state.turn.vars[XIANZHEN_WIN_TARGET_VIEW_KEY];
  if (typeof target === 'number' && target !== source && state.players[target]?.alive) return target;
}

export function viewExtraCardTarget(view: GameView, source: number, cardName: string): number | undefined {
  if (!allowsExtraTarget(cardName) || !view.players[source]?.skills.includes('界陷阵')) return;
  const target = view.players[source]?.turnUsage?.[XIANZHEN_WIN_TARGET_VIEW_KEY];
  if (typeof target === 'number' && target !== source && view.players[target]?.alive) return target;
}
