// 指定目标后:使用者指定某目标之后触发(use.md 时机5)。
// after hook 触发"指定目标后"时机技能(铁骑/烈弓/无双①等):判定/封印闪或令杀必中。
// 与 指定目标(声明阶段) 区别:指定目标 仅声明目标关系;本时机在结算流程中、
// 目标确定后触发,供判定/封印类技能介入影响后续响应。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 指定目标后: AtomDefinition<{ source: number; cardId?: string; target: number }> = {
  type: '指定目标后',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {
    // 事件标记——after hook 触发铁骑/烈弓/无双①等"指定目标后"时机技能
  },
  effect: { sound: 'target', animation: 'highlight', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = atom.cardId ? (state.cardMap[atom.cardId]?.name ?? atom.cardId) : undefined;
    const view: ViewEvent = {
      type: '指定目标后',
      source: atom.source,
      target: atom.target,
      ...(atom.cardId !== undefined ? { cardId: atom.cardId } : {}),
      ...(cardName !== undefined ? { cardName } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 事件标记——无 GameView 字段需要直接更新(封印/必中由后续 atom 的询问/伤害体现)。
  },
};

registerAtom(指定目标后);
