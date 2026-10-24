// 回合用量:提交公开用量与显式权威写入。技能经 setTurnUsage 在首个 await 前预占,
// atom.apply 复用同一个同步写入函数,亦支持组合动作的暂存/提交计划。
import type { AtomDefinition, AtomOfName, GameView, ViewEventSplit, ViewEvent, Json } from '../types';
import { commitTurnUsage } from '../rules/turn-usage';

export const 回合用量: AtomDefinition<AtomOfName<'回合用量'>> = {
  type: '回合用量',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    commitTurnUsage(state, atom.player, atom);
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '回合用量',
      player: atom.player,
      key: atom.key,
      value: atom.value,
    };
    // 用量信息对所有人可见(出杀次数/限一次是公开信息),用 othersView 广播。
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view: GameView, event) {
    const p = view.players[event.player as number];
    if (!p) return;
    p.turnUsage ??= {};
    const key = event.key as string;
    if (event.value === null) {
      delete p.turnUsage[key];
      return;
    }
    p.turnUsage[key] = event.value as Json;
  },
};

