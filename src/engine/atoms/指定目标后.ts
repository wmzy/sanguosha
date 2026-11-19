// 指定目标后:使用者指定某目标之后触发(use.md 时机5)。
// after hook 触发"指定目标后"时机技能(铁骑/烈弓/无双①等):判定/封印闪或令杀必中。
// 与 指定目标(声明阶段) 区别:指定目标 仅声明目标关系;本时机在结算流程中、
// 目标确定后触发,供判定/封印类技能介入影响后续响应。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition } from '../types';
import { requirePlayer } from './_helpers';
import { HIGHLIGHT_EFFECT, makeEventMarkerAtom, targetEventView } from './_eventMarker';

export const 指定目标后: AtomDefinition<{ source: number; cardId?: string; target: number }> =
  makeEventMarkerAtom('指定目标后', {
    validate: (state, atom) =>
      requirePlayer(state, atom.source, 'source') ?? requirePlayer(state, atom.target, 'target'),
    buildView: targetEventView,
    effect: HIGHLIGHT_EFFECT,
  });
