// 成为目标:结算阶段第一个 atom,标记目标正式进入结算流程。
// 与 指定目标(声明阶段) 不同:指定目标 是使用者声明所有合法目标,
// 成为目标 是结算循环中目标进入"被杀结算"状态。
// before hook 可被"不能成为目标"类技能拦截(空城/帷幕等 cancel)。
// after hook 触发"成为目标后"时机技能(流离转移等)。
// 事件标记型——apply 无副作用;广播策略 'always'(目标关系是可见事件流的一部分,
// before-hook cancel 不影响事件本身的可感知性)。
import type { AtomDefinition } from '../types';
import { requirePlayer } from './_helpers';
import { HIGHLIGHT_EFFECT, makeEventMarkerAtom, targetEventView } from './_eventMarker';

export const 成为目标: AtomDefinition<{ source: number; cardId?: string; target: number }> =
  makeEventMarkerAtom('成为目标', {
    validate: (state, atom) =>
      requirePlayer(state, atom.source, 'source') ?? requirePlayer(state, atom.target, 'target'),
    buildView: targetEventView,
    effect: HIGHLIGHT_EFFECT,
  });
