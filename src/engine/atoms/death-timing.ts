// src/engine/atoms/death-timing.ts
// 死亡编排时机 atom 定义(对齐 flow-redesign.md 模块 B / death.md 5 时机):
//   - 亮身份牌前 / 亮身份牌 / 死亡时 / 系统处理牌 / 死亡后
//   由 src/engine/death-flow.ts 的编排函数 runDeathFlow 在角色死亡时依次发出。
//
// 分工:
//   - 亮身份牌前 / 死亡时 / 死亡后:事件标记型(validate 恒通过、apply 无副作用,
//     只提供 before/after hook 注册点)。死亡时/死亡后 携带 killer(致死来源)供技能读取。
//   - 亮身份牌:实质 view 操作——apply 在 state 上无字段可改(PlayerState 无 identityHidden),
//     身份揭示纯走 view 层(toViewEvents 携带 identity,applyView 在 GameView 上揭示)。
//   - 系统处理牌:实质 atom——apply 搬原 击杀.apply 的弃牌+alive=false 逻辑
//     (手牌/装备入弃牌堆、alive=false),toViewEvents/applyView 携带 death 视图。
//
// 噪声抑制:无 before hook 时标记型 atom 的 toViewEvents 返回 null(整个 atom 视图上 no-op),
// 与 damage-timing / life-timing 一致。atom 本身仍走完整 pipeline(apply + after hooks),
// 编排函数/测试可从 state.atomHistory 观察时序。
//
// 兼容:击杀 atom(src/engine/atoms/击杀.ts)保留不动作为「raw kill」兼容别名;
// 主流程(系统规则.runDyingFlow)改走 runDeathFlow → 系统处理牌,不再 apply 击杀。
import type { AtomDefinition, GameState, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

/** 死亡时机 atom 的公共形状(含可选 killer)。 */
type DeathTimingAtom = { player: number; killer?: number };

/** 校验 player 存在(纯标记,不校验存活——编排函数前置保证)。 */
function validateDeathTiming(state: { players: Array<{ index: number }> }, atom: { player: number }): string | null {
  if (!state.players[atom.player]) return `player ${atom.player} not found`;
  return null;
}

/** 无 before hook 时静默(no-op 视图),有 before-hook 时发通知事件(携带 killer)。 */
function deathTimingView(state: GameState, type: string, atom: DeathTimingAtom): ViewEventSplit {
  if (getBeforeHooks(state, type).length === 0) {
    return { ownerViews: new Map(), othersView: null };
  }
  const view: ViewEvent = { type, player: atom.player, killer: atom.killer };
  return { ownerViews: new Map(), othersView: view };
}

// ── 时机1:亮身份牌前(焚心·转移身份) ─────────────────────────
// 纯标记,before-hook 可改写身份(焚心)。无 after-hook 技能。
export const 亮身份牌前: AtomDefinition<{ player: number }> = {
  type: '亮身份牌前',
  validate: validateDeathTiming,
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '亮身份牌前').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '亮身份牌前', player: atom.player };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(亮身份牌前);

// ── 时机2:亮身份牌(揭示阵亡者身份) ──────────────────────────
// apply 在 state 上无字段可改(PlayerState 无 identityHidden);身份揭示纯走 view 层。
// toViewEvents 携带阵亡者 identity(死亡即公开,所有视角可见),applyView 在 GameView 上揭示。
export const 亮身份牌: AtomDefinition<{ player: number }> = {
  type: '亮身份牌',
  validate: validateDeathTiming,
  apply() {},
  effect: { sound: 'death', animation: 'fade', duration: 1500 },
  toViewEvents(state, atom): ViewEventSplit {
    // 携带阵亡玩家身份——死亡即公开,所有视角都需揭示(与原 击杀.toViewEvents 一致)
    const identity = state.players[atom.player]?.identity;
    const view: ViewEvent = { type: '亮身份牌', player: atom.player, identity };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    // 揭示阵亡身份(死亡即公开,所有视角可见)
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi >= 0) {
      const identity = event.identity as string | undefined;
      if (identity) {
        view.players[pi].identity = identity;
        view.players[pi].identityHidden = false;
      }
    }
  },
  toViewLog(event) {
    return { player: event.player as number, text: '阵亡' };
  },
};

registerAtom(亮身份牌);

// ── 时机3:死亡时(行殇/断肠/界节命——在系统处理牌之前) ────────
// 纯标记,after-hook 触发死亡时技能。断肠在此移除凶手技能(系统处理牌弃牌之前)。
// killer 供技能读取(断肠移除凶手技能;行殇/界节命不依赖 killer)。
export const 死亡时: AtomDefinition<DeathTimingAtom> = {
  type: '死亡时',
  validate: validateDeathTiming,
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    return deathTimingView(state, '死亡时', atom);
  },
  applyView() {},
};

registerAtom(死亡时);

// ── 时机4:系统处理牌(弃手牌+装备入弃牌堆 + alive=false) ──────
// 实质 atom:搬原 击杀.apply 的弃牌+alive=false 逻辑。
// toViewEvents/applyView 参考原 击杀.ts(弃牌堆计数 + alive=false + hand 清空),不含身份揭示
// (身份揭示由 亮身份牌 时机负责)。
export const 系统处理牌: AtomDefinition<{ player: number }> = {
  type: '系统处理牌',
  validate(state, atom) {
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const p = state.players[atom.player];
    p.alive = false;
    // 死亡:手牌和装备进入弃牌堆
    for (const cardId of p.hand) state.zones.discardPile.push(cardId);
    p.hand = [];
    for (const slot of Object.keys(p.equipment) as Array<keyof typeof p.equipment>) {
      const equipId = p.equipment[slot];
      if (equipId) {
        state.zones.discardPile.push(equipId);
        delete p.equipment[slot];
      }
    }
  },
  effect: { sound: 'death', animation: 'fade', duration: 1500 },
  toViewEvents(state, atom): ViewEventSplit {
    const view: ViewEvent = { type: '系统处理牌', player: atom.player };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi >= 0) {
      const p = view.players[pi];
      // 弃牌堆计数:手牌数 + 装备数(与 apply 对称)
      const handCount = p.handCount;
      const equipCount = Object.values(p.equipment).filter(Boolean).length;
      if (view.zones) {
        view.zones.discardPileCount += handCount + equipCount;
      }
      p.alive = false;
      // 只有 owner(viewer === 阵亡玩家)才清 hand 为 [];
      // 非 owner 的 hand 是 undefined,保持 undefined
      if (view.viewer === (event.player as number)) {
        p.hand = [];
      }
      p.handCount = 0;
      p.equipment = {};
    }
  },
  toViewLog(event) {
    return { player: event.player as number, text: '阵亡' };
  },
};

registerAtom(系统处理牌);

// ── 时机5:死亡后(功獒/界完杀 cleanup) ───────────────────────
// 纯标记,after-hook 触发死亡后技能(在系统处理牌与奖惩之后)。
export const 死亡后: AtomDefinition<DeathTimingAtom> = {
  type: '死亡后',
  validate: validateDeathTiming,
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    return deathTimingView(state, '死亡后', atom);
  },
  applyView() {},
};

registerAtom(死亡后);

// ── 濒死编排时机(对齐 flow-redesign.md 模块 C / neardeath.md) ────
// 进入濒死状态时 / 新的濒死状态时:事件标记型,validate 恒通过、apply 无副作用,
// 只提供 before/after hook 注册点。由 系统规则.runDyingFlow 在濒死流程中发出。
//
// 与 陷入濒死 的分工://   - 陷入濒死(保留):濒死开始的系统通知。不屈/涅槃/伏枥/仁心等救援技 after-hook 挂此。
//   - 进入濒死状态时(新增):补益/随势① 独立时机。在陷入濒死 + 不屈检查之后、求桃循环之前发出。
//     补益等"其他角色可能直接回血化解"的技能挂此。
//   - 新的濒死状态时(新增):被救仍濒死(回复体力后 health 仍 <= 0)时触发,
//     随后 runDyingFlow 重置响应起点为当前响应者、重新逆时针。新一轮求桃中可能再次触发。
//
// 噪声抑制:无 before hook 时静默(与亮身份牌前/死亡时/死亡后一致)。
// 注意:这两个 atom 用 target 字段(与 陷入濒死 一致),而非 death-timing 的 player 字段。

/** 校验 target 存在(纯标记,不校验存活/濒死——编排函数前置保证)。 */
function validateDyingTiming(
  state: { players: Array<{ index: number }> },
  atom: { target: number },
): string | null {
  if (!state.players[atom.target]) return `target ${atom.target} not found`;
  return null;
}

// ── 进入濒死状态时(补益/随势①)─────────────────────────────
export const 进入濒死状态时: AtomDefinition<{ target: number }> = {
  type: '进入濒死状态时',
  validate: validateDyingTiming,
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '进入濒死状态时').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '进入濒死状态时', target: atom.target };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(进入濒死状态时);

// ── 新的濒死状态时(被救仍濒死,重置响应起点)──────────────
export const 新的濒死状态时: AtomDefinition<{ target: number }> = {
  type: '新的濒死状态时',
  validate: validateDyingTiming,
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '新的濒死状态时').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = { type: '新的濒死状态时', target: atom.target };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(新的濒死状态时);
