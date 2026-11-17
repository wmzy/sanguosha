// src/engine/atoms/statechange-timing.ts
// 状态变更编排时机 atom 定义(对齐 出牌流程重设计.md 模块 E):
//   - 翻面后 / 横置后 / 武将牌明置后 / 武将牌移除后 / 游戏牌亮出后
//   全部为事件标记型:validate 恒通过、apply 无副作用,只提供 before/after hook 注册点,
//   四件套样板由 _timing.makeTimingAtom 统一产出。
//   由各状态变更编排路径在实质操作后依次发出。
//
// 触发方:
//   翻面后    —— src/engine/face-down.ts 的 flipFaceDown/flipFaceUp(加标签/去标签 后)
//   横置后    —— src/engine/face-down.ts 的 setChain(设横置 后;设横置 被 before-hook cancel 时不发)
//   武将牌明置后 / 武将牌移除后 —— 暗将机制未引入,暂无触发方(闺秀①②未来消费)
//   游戏牌亮出后 —— 牌面公开时机,暂无触发方(鹰扬未来消费)
//
// 噪声抑制:无 before hook 时标记型 atom 的 toViewEvents 返回 null(整个 atom 视图上 no-op),
// 与 damage-timing / life-timing 一致。atom 本身仍走完整 pipeline(apply + after hooks),
// 编排函数/测试可从 state.atomHistory 观察时序。
import type { AtomDefinition, GameState, ViewEvent } from '../types';
import { makeTimingAtom } from './_timing';
import { requirePlayer } from './_helpers';

/** 校验 player 存在(纯标记,不校验存活——编排函数前置保证)。 */
function validatePlayer(state: GameState, player: number): string | null {
  return requirePlayer(state, player, 'player');
}

/** 单 player 型通知事件 payload(武将牌明置后/武将牌移除后)。 */
function singlePlayerView(type: string, atom: { player: number }): ViewEvent {
  return { type, player: atom.player };
}

// ── 翻面后(解围 after-hook:faceDown=true 翻成背面时触发) ──────
export const 翻面后: AtomDefinition<{ player: number; faceDown: boolean }> = makeTimingAtom(
  '翻面后',
  (state, atom) => validatePlayer(state, atom.player),
  (type, atom) => ({ type, player: atom.player, faceDown: atom.faceDown }),
);


// ── 横置后(法恩 after-hook:chained=true 横置时触发) ──────────
export const 横置后: AtomDefinition<{ player: number; chained: boolean }> = makeTimingAtom(
  '横置后',
  (state, atom) => validatePlayer(state, atom.player),
  (type, atom) => ({ type, player: atom.player, chained: atom.chained }),
);


// ── 武将牌明置后(闺秀① after-hook) ──────────────────────────
// 暗将机制未引入:武将牌开局即明置,此 atom 暂无触发方。
export const 武将牌明置后: AtomDefinition<{ player: number }> = makeTimingAtom(
  '武将牌明置后',
  (state, atom) => validatePlayer(state, atom.player),
  singlePlayerView,
);


// ── 武将牌移除后(闺秀② after-hook) ──────────────────────────
// 暗将机制未引入,此 atom 暂无触发方。
export const 武将牌移除后: AtomDefinition<{ player: number }> = makeTimingAtom(
  '武将牌移除后',
  (state, atom) => validatePlayer(state, atom.player),
  singlePlayerView,
);


// ── 游戏牌亮出后(鹰扬 after-hook) ────────────────────────────
// 牌面公开时机(展示/亮出 等)。暂无触发方——鹰扬未来消费。
export const 游戏牌亮出后: AtomDefinition<{ player: number; cardId: string }> = makeTimingAtom(
  '游戏牌亮出后',
  (state, atom) => {
    const err = validatePlayer(state, atom.player);
    if (err) return err;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  (type, atom) => ({ type, player: atom.player, cardId: atom.cardId }),
);
