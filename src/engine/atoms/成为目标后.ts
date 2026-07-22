// 成为目标后:某玩家成为目标之后触发(use.md 时机6)。
// after hook 触发"成为目标后"时机技能(贞烈/无双②等):目标方的响应/代价型技能。
// 与 成为目标 区别:成为目标 标记目标进入结算(before 可被空城/帷幕拦截 cancel);
// 本时机在其后触发贞烈等"成为目标后"响应,此时目标已确定有效。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 成为目标后: AtomDefinition<{ source: number; cardId?: string; target: number }> = {
  type: '成为目标后',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {
    // 事件标记——after hook 触发贞烈/无双②等"成为目标后"时机技能
  },
  effect: { sound: 'target', animation: 'highlight', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = atom.cardId ? (state.cardMap[atom.cardId]?.name ?? atom.cardId) : undefined;
    const view: ViewEvent = {
      type: '成为目标后',
      source: atom.source,
      target: atom.target,
      ...(atom.cardId !== undefined ? { cardId: atom.cardId } : {}),
      ...(cardName !== undefined ? { cardName } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 事件标记——无 GameView 字段需要直接更新(代价/响应由后续 atom 体现)。
  },
};

registerAtom(成为目标后);
