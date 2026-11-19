// 声明打出时:玩家声明打出一张牌时触发(play.md 时机1)。
// before hook 可被转化技替换:将声明的牌替换为另一张(武圣打出杀/丈八蛇矛等)。
// 与"使用"区别:打出(如响应南蛮入侵的杀、拼点牌)不进入使用结算流程,
// 仅经过声明→生效两步;本时机是声明阶段的转化/替换点。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition } from '../types';
import { requirePlayer } from './_helpers';
import { HIGHLIGHT_EFFECT, makeEventMarkerAtom, playEventView } from './_eventMarker';

export const 声明打出时: AtomDefinition<{ player: number; cardId: string }> = makeEventMarkerAtom(
  '声明打出时',
  {
    validate: (state, atom) => requirePlayer(state, atom.player, 'player'),
    buildView: playEventView,
    effect: HIGHLIGHT_EFFECT,
  },
);
