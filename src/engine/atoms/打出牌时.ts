// 打出牌时:牌被打出(生效)时触发(play.md 时机2)。
// after hook 触发"打出牌时"时机技能(雷击/涯角等):打出特定牌后触发判定/摸牌。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition } from '../types';
import { requirePlayer } from './_helpers';
import { HIGHLIGHT_EFFECT, makeEventMarkerAtom, playEventView } from './_eventMarker';

export const 打出牌时: AtomDefinition<{ player: number; cardId: string }> = makeEventMarkerAtom(
  '打出牌时',
  {
    validate: (state, atom) => requirePlayer(state, atom.player, 'player'),
    // 打出按牌名播报语音(sound/card/{牌名}),与「使用时」对齐;无语音文件的牌静默跳过
    buildView: (type, state, atom) => playEventView(type, state, atom, true),
    effect: HIGHLIGHT_EFFECT,
  },
);
