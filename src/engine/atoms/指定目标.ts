// src/engine/atoms/指定目标.ts
// 指定目标:事件标记(目标关系在事件流中记录)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 指定目标: AtomDefinition<{ source: number; cardId?: string; target: number }> = {
  type: '指定目标',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply(_state) {
    // 事件标记——目标关系在事件流中记录
  },
  effect: { sound: 'target', animation: 'highlight', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = atom.cardId ? (state.cardMap[atom.cardId]?.name ?? atom.cardId) : undefined;
    const view: ViewEvent = {
      type: '指定目标',
      source: atom.source,
      target: atom.target,
      ...(atom.cardId !== undefined ? { cardId: atom.cardId } : {}),
      ...(cardName !== undefined ? { cardName } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(_view, _event) {
    // 事件标记——目标关系在事件流中记录,前端 highlight 通过 effect 动画展示。
    // 无 GameView 字段需要直接更新(高亮态由前端处理 effect 期间临时绘制)。
  },
  toViewLog(event) {
    const target = event.target as number;
    return event.cardId
      ? {
          player: event.source as number,
          text: `使用 ${event.cardName ?? event.cardId} 指定 P${target} 为目标`,
        }
      : { player: event.source as number, text: `指定 P${target} 为目标` };
  },
};

registerAtom(指定目标);
