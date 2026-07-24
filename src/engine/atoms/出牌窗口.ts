// 出牌窗口:非阻塞型等待 atom — 出牌阶段的"控制权 token"。
//
// 与请求回应的区别:出牌窗口不要求玩家做任何特定动作。玩家可自由出牌/用技/结束回合,
// 每次操作都 resolve 当前窗口(回合管理的 IIFE 循环重建它)。超时则结束回合。
// isBlocking=false 让 hasBlockingPending / 前端 isPerspectiveAwaiting 跳过它。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { applyAtom, resolveTimeoutMs } from '../create-engine';
import { registerAtom } from '../atom';

const DEFAULT_TIMEOUT_SEC = 50;

export const 出牌窗口: AtomDefinition<{ player: number; timeout?: number }> = {
  type: '出牌窗口',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player not found`;
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    // 超时:放弃出牌 → 结束出牌阶段 → hook 自动链到 弃牌→回合结束→回合结束 atom
    //   (回合收尾已集中在 回合管理 hook 的「回合结束阶段」处理)
    async onTimeout(state, atom) {
      await applyAtom(state, { type: '阶段结束', player: atom.player, phase: '出牌' });
    },
    prompt: { type: 'confirm', title: '出牌阶段', cancelLabel: '结束回合' },
    timeout: DEFAULT_TIMEOUT_SEC,
    // 非阻塞:玩家可在出牌窗口期间自由操作
    isBlocking: false,
  },
  effect: { blockUntilDone: true, duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    const timeoutMs = resolveTimeoutMs(state, DEFAULT_TIMEOUT_SEC);
    const playerView: ViewEvent = {
      type: '出牌窗口',
      player: atom.player,
      timeoutMs,
    };
    const othersView: ViewEvent = {
      type: '出牌窗口',
      player: atom.player,
      timeoutMs,
    };
    return {
      ownerViews: new Map([[atom.player, playerView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const player = event.player as number;
    const timeoutMs = (event.timeoutMs as number | undefined) ?? DEFAULT_TIMEOUT_SEC * 1000;
    // player viewer: 出牌阶段 pending(非阻塞,前端据此渲染出牌 UI 而非回应面板)
    if (view.viewer === player) {
      view.pending = {
        type: 'awaits',
        atom: { type: '出牌窗口', player } as unknown as import('../types').Atom,
        prompt: { type: 'confirm', title: '出牌阶段', cancelLabel: '结束回合' },
        target: player,
        isBlocking: false,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    } else {
      // 其他 viewer:观察型 pending(不可操作)
      view.pending = {
        type: 'awaits',
        atom: { type: '出牌窗口', player } as unknown as import('../types').Atom,
        prompt: { type: 'confirm', title: '等待出牌', cancelLabel: '' },
        target: player,
        isBlocking: false,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    }
  },
};

registerAtom(出牌窗口);
