// src/engine/atoms/statechange-timing.ts
// 状态变更编排时机 atom 定义(对齐 出牌流程重设计.md 模块 E):
//   - 翻面后 / 横置后 / 武将牌明置后 / 武将牌移除后 / 游戏牌亮出后
//   全部为事件标记型:validate 恒通过、apply 无副作用,只提供 before/after hook 注册点。
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
import type { AtomDefinition, GameState, ViewEventSplit } from '../types';
import { hookSilentView, requirePlayer } from './_helpers';

/** 校验 player 存在(纯标记,不校验存活——编排函数前置保证)。 */
function validatePlayer(state: GameState, player: number): string | null {
  return requirePlayer(state, player, 'player');
}

/** 单 player 标记型 atom 的视图:无 before hook 时静默,有则发通知事件。 */
function singlePlayerView(state: GameState, type: string, player: number): ViewEventSplit {
  return hookSilentView(state, type, () => ({ type, player }));
}

// ── 翻面后(解围 after-hook:faceDown=true 翻成背面时触发) ──────
export const 翻面后: AtomDefinition<{ player: number; faceDown: boolean }> = {
  type: '翻面后',
  validate(state, atom) {
    return validatePlayer(state, atom.player);
  },
  apply() {},
  toViewEvents(state, atom) {
    return hookSilentView(state, '翻面后', () => ({
      type: '翻面后',
      player: atom.player,
      faceDown: atom.faceDown,
    }));
  },
  applyView() {},
};


// ── 横置后(法恩 after-hook:chained=true 横置时触发) ──────────
export const 横置后: AtomDefinition<{ player: number; chained: boolean }> = {
  type: '横置后',
  validate(state, atom) {
    return validatePlayer(state, atom.player);
  },
  apply() {},
  toViewEvents(state, atom) {
    return hookSilentView(state, '横置后', () => ({
      type: '横置后',
      player: atom.player,
      chained: atom.chained,
    }));
  },
  applyView() {},
};


// ── 武将牌明置后(闺秀① after-hook) ──────────────────────────
// 暗将机制未引入:武将牌开局即明置,此 atom 暂无触发方。
export const 武将牌明置后: AtomDefinition<{ player: number }> = {
  type: '武将牌明置后',
  validate(state, atom) {
    return validatePlayer(state, atom.player);
  },
  apply() {},
  toViewEvents(state, atom) {
    return singlePlayerView(state, '武将牌明置后', atom.player);
  },
  applyView() {},
};


// ── 武将牌移除后(闺秀② after-hook) ──────────────────────────
// 暗将机制未引入,此 atom 暂无触发方。
export const 武将牌移除后: AtomDefinition<{ player: number }> = {
  type: '武将牌移除后',
  validate(state, atom) {
    return validatePlayer(state, atom.player);
  },
  apply() {},
  toViewEvents(state, atom) {
    return singlePlayerView(state, '武将牌移除后', atom.player);
  },
  applyView() {},
};


// ── 游戏牌亮出后(鹰扬 after-hook) ────────────────────────────
// 牌面公开时机(展示/亮出 等)。暂无触发方——鹰扬未来消费。
export const 游戏牌亮出后: AtomDefinition<{ player: number; cardId: string }> = {
  type: '游戏牌亮出后',
  validate(state, atom) {
    const err = validatePlayer(state, atom.player);
    if (err) return err;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom) {
    return hookSilentView(state, '游戏牌亮出后', () => ({
      type: '游戏牌亮出后',
      player: atom.player,
      cardId: atom.cardId,
    }));
  },
  applyView() {},
};

