// 生效时:使用结算中,牌未被抵消、确定将会生效时触发(use.md 使用结算中 时机3)。
//
// 对应规则:"生效时:若此牌未被抵消,确定将会生效。"
// 能发动的技能:谦逊。
//
// 仅在 生效前 未被 cancel 时到达(runUseFlow 在 生效前 返回 false 时跳过)。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
// 噪声抑制(viewMode 'silentWithoutHook'):无 before hook 时整个 atom 是 no-op,不发 ViewEvent。
import type { AtomDefinition } from '../types';
import { requirePlayer } from './_helpers';
import { makeEventMarkerAtom, resolveTimingView } from './_eventMarker';

export const 生效时: AtomDefinition<{ source: number; target: number; cardId: string }> =
  makeEventMarkerAtom('生效时', {
    validate: (state, atom) => requirePlayer(state, atom.target, 'target'),
    buildView: resolveTimingView,
    viewMode: 'silentWithoutHook',
  });
