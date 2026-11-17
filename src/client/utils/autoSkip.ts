// src/client/utils/autoSkip.ts
// 通用「无法响应时自动跳过」客户端辅助模块。
//
// 目标:在需要用户回应的 pending 上,当玩家无法响应(或主动选择跳过)时代发 skip,
// 省去无意义的等待/点击。纯用户体验改进——绝不改变游戏胜负逻辑(能响应时绝不干预)。
//
// 两层行为:
//   维度1(强制):无法响应时自动跳过,防止恶意拖延。
//     - 公开可知无法响应(handCount===0):立即跳过(所有人都能看到你空手牌)。
//     - 私有可知无法响应(有手牌但无匹配牌/无可用转化技):随机延迟后跳过,
//       让"没牌可打"与"有牌在思考"在时间上不可区分,避免泄露手牌信息。
//   维度2(用户可选):用户可勾选「自动跳过此类询问」(如无懈可击),无论能否响应都延迟跳过。
//
// 信息泄露边界 = handCount。handCount 对所有 viewer 公开(view.players[].handCount),
// 故 handCount===0 是"所有人都能推断你无法响应"的安全立即跳过条件;
// handCount>0 但无匹配牌只有玩家自己知道,必须延迟以模拟思考时间。
//
// 技能(看破/武圣等转化技)的考量天然包含在 canRespond 里——调用方负责计算
// "是否有非 skip 的可操作 action"(含转化技),模块本身不维护技能名单。

import type { GameView, PendingView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import type { PendingRespondInfo } from './pendingRespond';
import { getPendingRequestType, respondCandidates } from './pendingRespond';
import { isActiveAction } from './gameViewHelpers';

// ─── 类型 ────────────────────────────────────────────────────

/** 自动跳过决策结果。 */
export type AutoSkipDecision =
  | { kind: 'act-now' } /** 立即跳过(公开无法响应) */
  | { kind: 'act-delayed'; ms: number } /** 延迟 ms 后跳过(防泄露 / 策略跳过) */
  | { kind: 'wait' }; /** 不干预,等用户操作 */

/** 用户偏好(持久化到 localStorage)。 */
export interface AutoSkipPrefs {
  /** 用户主动开启「代我跳过」的 requestType 集合(如 { '无懈可击': true })。
   *  开启后该类型询问无论能否响应都延迟跳过。 */
  optInSkip: Record<string, boolean>;
}

/** decideAutoSkip 的输入。canRespond 由调用方计算(前端/headless 各有枚举方式)。 */
export interface AutoSkipInput {
  pending: PendingView | null;
  /** 当前 viewer 是否有任何非 skip 的可操作回应 action(含转化技)。 */
  canRespond: boolean;
  /** 当前 viewer 的公开手牌数(view.players[viewer].handCount)。 */
  handCount: number;
  prefs: AutoSkipPrefs;
  /** 延迟范围 [min, max] ms,默认 [500, 2000]。 */
  delayRange?: [number, number];
  /** 随机源(测试注入),默认 Math.random。 */
  rng?: () => number;
}

// ─── 常量 ────────────────────────────────────────────────────

/** 默认延迟范围:500ms–2000ms,模拟人类思考时间,防手牌信息泄露。 */
export const DEFAULT_DELAY_RANGE: [number, number] = [500, 2000];

export const DEFAULT_PREFS: AutoSkipPrefs = { optInSkip: {} };

// ─── 核心决策 ────────────────────────────────────────────────

/** pending 是否可被自动跳过(排除出牌窗口、强制型询问)。 */
function isAutoSkippable(pending: PendingView): boolean {
  // 出牌窗口(isBlocking===false)是出牌阶段控制权 token,不是回应询问
  if (pending.isBlocking === false) return false;
  // 强制型(mandatory=true,如英魂弃牌):必须回应,不能自动跳过
  if (pending.mandatory === true) return false;
  return true;
}

/** 在 [min,max] 范围内取随机延迟毫秒。 */
function randomDelay(range: [number, number], rng: () => number): number {
  const [min, max] = range;
  return Math.round(min + rng() * (max - min));
}

/**
 * 自动跳过决策(纯函数,不依赖 React/headless)。
 *
 * 优先级(高→低):
 *   1. pending 为空 / 不可跳过(出牌窗口/强制型) → wait
 *   2. 用户开启该类型策略跳过 → act-delayed(不暴露能否响应)
 *   3. 能响应 → wait
 *   4. 空手牌(公开) → act-now
 *   5. 有手牌但无法响应(私有) → act-delayed
 */
export function decideAutoSkip(input: AutoSkipInput): AutoSkipDecision {
  const { pending, canRespond, handCount, prefs } = input;
  if (!pending || !isAutoSkippable(pending)) return { kind: 'wait' };

  const range = input.delayRange ?? DEFAULT_DELAY_RANGE;
  const rng = input.rng ?? Math.random;
  const reqType = getPendingRequestType(pending);

  // 维度2:用户策略跳过(无论能否响应,延迟跳过)
  if (reqType && prefs.optInSkip[reqType]) {
    return { kind: 'act-delayed', ms: randomDelay(range, rng) };
  }

  // 维度1(强制):无法响应自动跳过
  if (canRespond) return { kind: 'wait' };
  // 公开无法响应(空手牌)立即;私有(有手牌无匹配)延迟
  if (handCount === 0) return { kind: 'act-now' };
  return { kind: 'act-delayed', ms: randomDelay(range, rng) };
}

// ─── 前端便捷:从 view 计算 canRespond ────────────────────────

/**
 * 计算当前 viewer 是否能响应 pending(前端视角,含转化技)。
 *
 * - 非 useCard 类 prompt(confirm/choosePlayer/useCardAndTarget/...):总有操作按钮 → true
 * - useCard 卡牌回应型:共享候选集非空 OR 有激活的转化技 transform action。
 *   候选判据与浏览器选牌/无头枚举共用 respondCandidates(单一口径):投影层
 *   candidates(权威,可能含装备区牌)优先,否则 cardFilter 过滤手牌。
 *   修复:旧实现 hand.some(cardFilter) 只认手牌——界鬼才只持可换判定牌的装备时
 *   误判无法响应而代发 skip(空手牌时立即跳过,装备候选 UI 闪现即被跳)。
 *
 * 转化技(看破黑牌转无懈)通过 action.activeWhen 判断——其内部已检查
 * "无懈窗口 + 手牌有黑牌",故无需在此维护技能名单。
 */
export function computeCanRespondForView(
  view: GameView,
  viewer: number,
  skillActions: SkillActionDef[],
  pendingRespondInfo: PendingRespondInfo | null,
  pending: PendingView | null,
): boolean {
  if (!pending) return false;
  // 非 useCard 类型:总有操作按钮(确认/选目标/选牌等)
  if (pending.prompt?.type !== 'useCard') return true;
  // useCard 卡牌回应型
  const hand = view.players[viewer]?.hand ?? [];
  // 字面/装备候选匹配(共享候选集)
  if (respondCandidates(pendingRespondInfo, hand, view.cardMap).length > 0) return true;
  // 转化技 transform action(看破/武圣 等):activeWhen 判断激活
  const ctx = { view, perspectiveIdx: viewer };
  return skillActions.some(
    (a) => a.actionType === 'transform' && isActiveAction(a, ctx),
  );
}

/**
 * 前端便捷:从 view 一步决策(内部算 canRespond 再调 decideAutoSkip)。
 * 供 useAutoSkip hook 使用。
 */
export function decideAutoSkipForView(input: {
  view: GameView;
  viewer: number;
  skillActions: SkillActionDef[];
  pendingRespondInfo: PendingRespondInfo | null;
  prefs: AutoSkipPrefs;
  delayRange?: [number, number];
  rng?: () => number;
}): AutoSkipDecision {
  const { view, viewer, skillActions, pendingRespondInfo, prefs } = input;
  const pending = view.pending;
  const canRespond = computeCanRespondForView(
    view,
    viewer,
    skillActions,
    pendingRespondInfo,
    pending,
  );
  const handCount = view.players[viewer]?.handCount ?? 0;
  return decideAutoSkip({ pending, canRespond, handCount, prefs, delayRange: input.delayRange, rng: input.rng });
}

// ─── 自动跳过调度器(框架无关) ────────────────────────────────

/** 自动跳过调度器:封装「清上一定时器 → deadline 去重 → 决策 → act-now 立即 /
 *  act-delayed setTimeout → 触发时校验 deadline 未变(防串扰)」的编排,
 *  供 React hook(useAutoSkip)与 HeadlessGameClient(maybeAutoSkipBroadcast)
 *  共享,两端时序语义一致。 */
export interface AutoSkipScheduler {
  /** 通知 pending 窗口(重新)评估:先清上一个未触发的定时器,再按 deadline 去重
   *  (同一窗口只决策一次);decide 仅在通过去重后调用。act-now 立即触发 fire,
   *  act-delayed 延迟 ms 触发(触发前校验窗口未变)。 */
  schedule(pending: PendingView, decide: () => AutoSkipDecision): void;
  /** 清理未触发的延迟定时器(保留 deadline 去重状态;pending 消失/卸载/断开时调)。 */
  cancel(): void;
  /** 清定时器并重置 deadline 去重状态(对局重置回大厅时调)。 */
  reset(): void;
}

/**
 * 创建自动跳过调度器。
 * @param getLatestPending 读取当前最新 pending:延迟触发时校验窗口未变(防串扰
 *   双保险——延迟期间 view 可能推进到新 pending 如杀问询,旧 skip 不得误作用于
 *   新窗口;主防御是 schedule/cancel 的清理,此处比对决策时 deadline 拦截漏网)。
 * @param fire 触发 skip(立即或延迟到点;deadline 已校验未变)。参数为决策时的
 *   pending(广播型标记等需要决策时上下文时使用)。 */
export function createAutoSkipScheduler(
  getLatestPending: () => PendingView | null,
  fire: (pending: PendingView) => void,
): AutoSkipScheduler {
  /** 未触发的延迟 skip 定时器 */
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 已自动跳过的 pending deadline 去重键(deadline ?? 0;同一窗口只跳一次) */
  let skippedDeadline: number | null = null;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(pending, decide) {
      // 清理上一个未触发的延迟 skip(防串扰:view 已推进到新 pending,旧 skip 不应再发)
      cancel();
      // 去重:同一窗口(deadline)只决策一次
      const deadline = pending.deadline ?? 0;
      if (deadline === skippedDeadline) return;
      const decision = decide();
      if (decision.kind === 'wait') return;
      skippedDeadline = deadline;
      const fireGuarded = () => {
        const cur = getLatestPending();
        if (!cur || (cur.deadline ?? 0) !== deadline) return;
        fire(pending);
      };
      if (decision.kind === 'act-now') {
        fireGuarded();
      } else {
        timer = setTimeout(() => {
          timer = null;
          fireGuarded();
        }, decision.ms);
      }
    },
    cancel,
    reset() {
      cancel();
      skippedDeadline = null;
    },
  };
}
