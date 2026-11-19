// 生效前:使用结算中,牌对目标生效之前触发(use.md 使用结算中 时机2)。
//
// 对应规则:"生效前:可以对此牌进行响应。"
// 杀: handleSlashDodge 询间是否使用闪,发出闪的「生效前」atom。
// 无双/肉林在闪的「生效前」before-hook 中 cancel 第一次闪。
//
// before hook 返回 { kind: 'cancel' } = 此牌被抵消(闪生效),
// 调用方(runUseFlow)据此跳过 生效时/生效后,直接进入下一个目标。
//
// 事件标记型——apply 无副作用,只提供 hook 注册点。
// 噪声抑制(viewMode 'silentWithoutHook'):无 before hook 时整个 atom 是 no-op,不发 ViewEvent。
import type { AtomDefinition } from '../types';
import { requirePlayer } from './_helpers';
import { makeEventMarkerAtom, resolveTimingView } from './_eventMarker';

export const 生效前: AtomDefinition<{ source: number; target: number; cardId: string }> =
  makeEventMarkerAtom('生效前', {
    validate: (state, atom) => requirePlayer(state, atom.target, 'target'),
    buildView: resolveTimingView,
    viewMode: 'silentWithoutHook',
  });
