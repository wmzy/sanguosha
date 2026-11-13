// src/engine/atoms/_helpers.ts
// atoms 内部共享样板收敛(下划线开头 = atoms 目录内部工具,不对外导出业务概念):
//   - requirePlayer:validate 的「玩家存在」检查(错误文案 `${role} ${idx} not found`)。
//   - viewPlayer:applyView 的「按座次定位 view.players 条目」。
//   - broadcast:toViewEvents 的「全员广播」ViewEventSplit(无 per-player 分叉)。
//   - hookSilentView:标记型时机 atom 的「无 before-hook 则静默」视图工厂。
import type { GameState, GameView, ViewEvent, ViewEventSplit } from '../types';
import { getBeforeHooks } from '../core/skill';

/** GameView.players 的单条目形状(viewPlayer 的返回元素)。 */
export type PlayerViewEntry = GameView['players'][number];

/**
 * validate 的玩家存在检查:玩家不存在返回 `${role} ${idx} not found`,存在返回 null。
 * role 为该 atom 中玩家字段的角色名(player/target/source/initiator/from/to),
 * 保证错误文案与收敛前逐字一致。
 */
export function requirePlayer(
  state: GameState,
  idx: number,
  role: 'player' | 'target' | 'source' | 'initiator' | 'from' | 'to',
): string | null {
  return state.players[idx] ? null : `${role} ${idx} not found`;
}

/**
 * applyView 的玩家定位:按座次 index 在 view.players 中找条目,找不到返回 undefined。
 * 取代 `const pi = view.players.findIndex(...); if (pi < 0) return;` 样板。
 */
export function viewPlayer(view: GameView, idx: number): PlayerViewEntry | undefined {
  return view.players.find((p) => p.index === idx);
}

/**
 * toViewEvents 的全员广播:无 per-owner 分叉的 ViewEventSplit。
 * view 为 null 表示无人感知此 atom(静默)。
 */
export function broadcast(view: ViewEvent | null): ViewEventSplit {
  return { ownerViews: new Map(), othersView: view };
}

/**
 * 标记型时机 atom 的视图工厂:无 before-hook 时静默(null 视图,整个 atom 视图上 no-op),
 * 有 before-hook 时广播 build() 构造的通知事件。atom 本身仍走完整 pipeline,
 * 编排函数/测试可从 state.atomHistory 观察时序。
 */
export function hookSilentView(
  state: GameState,
  type: string,
  build: () => ViewEvent,
): ViewEventSplit {
  if (getBeforeHooks(state, type).length === 0) {
    return broadcast(null);
  }
  return broadcast(build());
}
