// src/engine/atoms/_eventMarker.ts
// 事件标记型 atom 的共享工厂(下划线开头 = atoms 目录内部工具,不对外导出业务概念)。
//
// 指定目标/成为目标/指定目标后/成为目标后/生效前/生效时/打出牌时/声明打出时 八个
// 事件标记 atom 形状一致(五件套样板):
//   - validate:仅校验玩家存在(纯标记语义,不校验存活/数值——编排函数前置保证);
//   - apply:无副作用(只为 before/after hook 提供注册点;hook 语义因 atom 而异——
//     成为目标 的 before-hook cancel(空城/帷幕拦截)、声明打出时 的 before-hook
//     modify(转化技替换打出的牌)、打出牌时/指定目标后/成为目标后 的 after-hook
//     (雷击/铁骑/贞烈等)——但这些都由技能 hook 驱动,atom 定义本身无差异);
//   - effect:可选 atom 侧动画(目标关系/打出事件带 highlight);
//   - toViewEvents:按 viewMode 广播 payload('always' 无条件广播;
//     'silentWithoutHook' 无 before-hook 时静默,见 hookSilentView);
//   - applyView:no-op(实质变更由编排函数/后续实质 atom 负责)。
// 本工厂统一产出该五件套;三个共享 payload 构造器按事件族收敛(目标关系族/打出族/
// 生效结算族)。与 _timing.ts 的 makeTimingAtom 区分:那边是 damage/judge/life/rank/
// statechange/move/death 七族「时机」atom(可带 afterApply 回写通道),这边是
// 「事件标记」atom(无状态回写,差异仅在 payload 形状与通知策略)。
import type { AtomDefinition, AtomEffect, GameState, ViewEvent } from '../types';
import { broadcast, hookSilentView } from './_helpers';

/** highlight 高亮 effect:目标关系/打出事件的标准 atom 侧动画声明。 */
export const HIGHLIGHT_EFFECT: AtomEffect = { animation: 'highlight', duration: 400 };

/** 目标关系事件(指定目标/成为目标/指定目标后/成为目标后)的广播 payload 构造器:
 *  cardId 可选——携带时附 cardName(cardMap 查名,查不到回退原 id)。 */
export function targetEventView(
  type: string,
  state: GameState,
  atom: { source: number; cardId?: string; target: number },
): ViewEvent {
  const cardName = atom.cardId ? (state.cardMap[atom.cardId]?.name ?? atom.cardId) : undefined;
  return {
    type,
    source: atom.source,
    target: atom.target,
    ...(atom.cardId !== undefined ? { cardId: atom.cardId } : {}),
    ...(cardName !== undefined ? { cardName } : {}),
  };
}

/** 打出事件(声明打出时/打出牌时)的广播 payload 构造器:
 *  cardId 必填、cardName 恒携带(cardMap 查名,查不到回退原 id);
 *  withSound 时按牌名播报语音(sound/card/{牌名}),与「使用时」对齐,无语音文件的牌
 *  由前端静默跳过。 */
export function playEventView(
  type: string,
  state: GameState,
  atom: { player: number; cardId: string },
  withSound = false,
): ViewEvent {
  const cardName = state.cardMap[atom.cardId]?.name ?? atom.cardId;
  return {
    type,
    player: atom.player,
    cardId: atom.cardId,
    cardName,
    ...(withSound
      ? { effect: { sound: `card/${cardName}`, animation: 'highlight', duration: 400 } }
      : {}),
  };
}

/** 生效结算时机事件(生效前/生效时)的广播 payload 构造器:
 *  cardId 必填(牌已确定),不携带 cardName。 */
export function resolveTimingView(
  type: string,
  _state: GameState,
  atom: { source: number; target: number; cardId: string },
): ViewEvent {
  return {
    type,
    source: atom.source,
    target: atom.target,
    cardId: atom.cardId,
  };
}

/** 事件标记型 atom 的视图通知策略。 */
export type EventMarkerViewMode =
  /** 无条件广播——事件本身是可见事件流的一部分(目标关系/打出播报),hook 有无不影响。 */
  | 'always'
  /** 无 before-hook 时静默(hookSilentView)——atom 仅为 hook 注册点,无人注册时
   *  整个 atom 在视图上 no-op(生效前/生效时 的噪声抑制)。 */
  | 'silentWithoutHook';

/** makeEventMarkerAtom 的配置。 */
export interface EventMarkerOptions<T> {
  /** 存在性校验(纯标记语义,requirePlayer 组合)。 */
  validate: (state: GameState, atom: T) => string | null;
  /** 广播 payload 构造器(type 由工厂透传,保证 payload.type 与 atom type 一致)。 */
  buildView: (type: string, state: GameState, atom: T) => ViewEvent;
  /** 视图通知策略,默认 'always'。 */
  viewMode?: EventMarkerViewMode;
  /** atom 侧动画 effect(如 HIGHLIGHT_EFFECT)。 */
  effect?: AtomEffect;
  /** 前端日志条目生成(仅事件本身需要落日志的 atom 提供,如 指定目标)。 */
  toViewLog?: AtomDefinition<T>['toViewLog'];
}

/** 事件标记型 atom 工厂:统一产出 validate/apply/effect/toViewEvents/applyView
 *  五件套(见文件头注释)。 */
export function makeEventMarkerAtom<T>(type: string, opts: EventMarkerOptions<T>): AtomDefinition<T> {
  return {
    type,
    validate: opts.validate,
    apply() {},
    ...(opts.effect ? { effect: opts.effect } : {}),
    ...(opts.toViewLog ? { toViewLog: opts.toViewLog } : {}),
    toViewEvents(state, atom) {
      const build = () => opts.buildView(type, state, atom);
      return opts.viewMode === 'silentWithoutHook'
        ? hookSilentView(state, type, build)
        : broadcast(build());
    },
    applyView() {},
  };
}
