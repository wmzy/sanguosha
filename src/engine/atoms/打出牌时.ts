// 打出牌时:牌被打出(生效)时触发(play.md 时机2)。
// after hook 触发"打出牌时"时机技能(雷击/涯角等):打出特定牌后触发判定/摸牌。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 打出牌时: AtomDefinition<{ player: number; cardId: string }> = {
  type: '打出牌时',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply() {
    // 事件标记——after hook 触发雷击/涯角等"打出牌时"时机技能
  },
  effect: { sound: 'play_card', animation: 'highlight', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = state.cardMap[atom.cardId]?.name ?? atom.cardId;
    const view: ViewEvent = {
      type: '打出牌时',
      player: atom.player,
      cardId: atom.cardId,
      cardName,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 事件标记——无 GameView 字段需要直接更新(判定/摸牌由后续 atom 的 applyView 体现)。
  },
};

registerAtom(打出牌时);
