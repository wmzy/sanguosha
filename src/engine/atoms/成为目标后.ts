// 成为目标后:某玩家成为目标之后触发(use.md 时机6)。
// after hook 触发"成为目标后"时机技能(贞烈/无双②等):目标方的响应/代价型技能。
// 与 成为目标 区别:成为目标 标记目标进入结算(before 可被空城/帷幕拦截 cancel);
// 本时机在其后触发贞烈等"成为目标后"响应,此时目标已确定有效。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition } from '../types';
import { requirePlayer } from './_helpers';
import { HIGHLIGHT_EFFECT, makeEventMarkerAtom, targetEventView } from './_eventMarker';

export const 成为目标后: AtomDefinition<{ source: number; cardId?: string; target: number }> =
  makeEventMarkerAtom('成为目标后', {
    validate: (state, atom) =>
      requirePlayer(state, atom.source, 'source') ?? requirePlayer(state, atom.target, 'target'),
    buildView: targetEventView,
    effect: HIGHLIGHT_EFFECT,
  });
