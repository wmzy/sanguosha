// 声明打出时:玩家声明打出一张牌时触发(play.md 时机1)。
// before hook 可被转化技替换:将声明的牌替换为另一张(武圣打出杀/丈八蛇矛等)。
// 与"使用"区别:打出(如响应南蛮入侵的杀、拼点牌)不进入使用结算流程,
// 仅经过声明→生效两步;本时机是声明阶段的转化/替换点。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 声明打出时: AtomDefinition<{ player: number; cardId: string }> = {
  type: '声明打出时',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply() {
    // 事件标记——转化技可经 before hook modify 替换打出的牌
  },
  effect: { sound: 'play_card', animation: 'highlight', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = state.cardMap[atom.cardId]?.name ?? atom.cardId;
    const view: ViewEvent = {
      type: '声明打出时',
      player: atom.player,
      cardId: atom.cardId,
      cardName,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 事件标记——无 GameView 字段需要直接更新(转化由后续打出/响应 atom 体现)。
  },
};

registerAtom(声明打出时);
