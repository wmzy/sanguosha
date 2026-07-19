// src/client/utils/gameViewHelpers.ts
// GameView 相关纯函数(无 React 依赖)。从 GameView.tsx 提取。
//
// 这些函数封装"构造 action params"和"UI 布局计算"两类纯逻辑,
// 让组件/hook 专注于状态管理,函数专注于数据转换。

import type {
  ActionContext,
  ActionPrompt,
  Card,
  GameView,
  Json,
  DistributePrompt,
  TargetFilter,
} from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { defaultPlayActive } from '../../engine/action-active';

// ─── use action 查找(filter-based) ───
// 设计原则:action 声明即真相——技能 onMount 调 defineAction('use') 时通过
// prompt.cardFilter 声明"我适用于哪些牌",前端遍历当前玩家的 use action 跑 filter
// 匹配选中卡,而非用 card.name→skillId 反查。这消除了 playCardSkillId 这类
// 桥接表达,让"这张牌能触发哪些 use action"只有一个真相(声明里的 cardFilter)。
// 镜像 tests/engine-harness.ts 的 findValidCard。

/** 从 use action 的 prompt 中提取 cardFilter 函数(若有) */
export function extractCardFilter(prompt: ActionPrompt): ((card: Card) => boolean) | null {
  switch (prompt.type) {
    case 'useCard':
    case 'useCardAndTarget':
      return prompt.cardFilter.filter ?? null;
    default:
      return null;
  }
}

/**
 * 在一组 action 中,找出适用于指定卡牌的 use action(actionType='use' 且
 * cardFilter 匹配)。返回第一个匹配项——同一种交互(使用牌)下,每张牌
 * 恰好对应一个 use action(装备牌→装备通用,基本牌/锦囊→对应牌名的技能)。
 * @param actions 候选 action 集合(通常是当前视角玩家的 skillActions)
 * @param card   当前选中的卡牌
 */
export function findUseActionForCard(
  actions: SkillActionDef[],
  card: Card,
): SkillActionDef | undefined {
  return actions.find((a) => {
    if (a.actionType !== 'use') return false;
    const filter = extractCardFilter(a.prompt);
    return filter ? filter(card) : false;
  });
}

/** 不属于"出牌阶段替代出牌方式"的 actionType 集合。
 *  use=主出牌(主按钮);respond=被动回应(pending 驱动);
 *  transform=转化技(transformMode 入口);distribute=分配(distributeMode 入口)。
 *  这些均有各自的交互入口,不应在选中牌后作为 altAction 按钮重复出现。
 *  剩余类型(如 recast=铁索连环重铸)才是真正的"同一张牌的其他出法"。 */
const NON_ALT_ACTION_TYPES = new Set(['use', 'respond', 'transform', 'distribute']);

/**
 * 找出适用于指定卡牌的替代出牌动作(如铁索连环·重铸)。
 * 仅匹配真正的"出牌阶段替代出牌方式"(recast 等),排除 use/respond/transform/distribute
 * ——后者各有独立交互入口。避免选中桃后误出"出桃/respond""火攻/respond"等按钮。
 * @param actions 候选 action 集合
 * @param card   当前选中的卡牌
 */
export function findAltActionsForCard(
  actions: SkillActionDef[],
  card: Card,
): SkillActionDef[] {
  return actions.filter((a) => {
    if (NON_ALT_ACTION_TYPES.has(a.actionType)) return false;
    const filter = extractCardFilter(a.prompt);
    return filter ? filter(card) : false;
  });
}

// ─── params 构造 ───

/** 判断一个 action 在给定上下文下是否激活。
 *  优先用 action 声明的 activeWhen;未声明则用 defaultPlayActive(出牌场景默认:
 *  当前视角回合 + 出牌阶段 + 无阻塞型 pending)。
 *  这是“声明时机”原则的落地点:激活条件由 action 自己说,GameView 不再硬编码分支。
 *  defaultPlayActive 与 engine/action-active 同源(技能 onMount 也复用它)。 */
export function isActiveAction(action: SkillActionDef, ctx: ActionContext): boolean {
  return action.activeWhen ? action.activeWhen(ctx) : defaultPlayActive(ctx);
}

/** 出牌规则(从 use action 的 prompt 派生,替代 card-meta Set) */
export interface PlayRules {
  /** 是否需要选目标(slots 或 min>=1) */
  needsTarget: boolean;
  /** 是否多槽位目标(借刀杀人 A+B) */
  hasSlots: boolean;
  /** 槽位数(slots 模式) */
  slotCount: number;
  /** 是否自动以自己为目标(桃/酒) */
  selfTarget: boolean;
  /** 原始 targetFilter */
  targetFilter: TargetFilter | null;
}

/** 从 targetFilter + selfTarget 派生出牌规则 */
export function derivePlayRules(
  targetFilter: TargetFilter | null | undefined,
  selfTarget?: boolean,
): PlayRules {
  const slots = targetFilter?.slots;
  const hasSlots = !!slots && slots.length > 1;
  const slotCount = slots?.length ?? 0;
  const needsTarget = selfTarget
    ? false
    : hasSlots || (targetFilter ? targetFilter.max >= 1 : false);
  return {
    needsTarget,
    hasSlots,
    slotCount,
    selfTarget: !!selfTarget,
    targetFilter: targetFilter ?? null,
  };
}

/**
 * 构造出牌 action 的 params。
 * 由出牌规则(PlayRules,从 use action prompt 派生)决定 target/targets/killTarget 字段。
 * @param players            全部玩家(nameToIndex 用)
 * @param perspectiveIdx     当前视角座次(取自己 name)
 * @param card               要出的牌
 * @param rules              出牌规则(从 prompt 派生)
 * @param selectedTarget     已选目标 name(A 目标)
 * @param selectedKillTarget 借刀杀人 B 目标 name
 * @returns params;若不满足出牌条件(需目标未选等)返回 null
 */
export function buildPlayParams(
  players: GameView['players'],
  perspectiveIdx: number,
  card: Card,
  rules: PlayRules,
  selectedTarget: string | null,
  selectedKillTarget: string | null,
): Record<string, Json> | null {
  const selfName = players[perspectiveIdx]?.name ?? '';
  if (rules.hasSlots) {
    // 借刀杀人:需 A + B 两个目标
    if (!selectedTarget || !selectedKillTarget) return null;
    const aIdx = players.findIndex((p) => p.name === selectedTarget);
    const bIdx = players.findIndex((p) => p.name === selectedKillTarget);
    if (aIdx < 0 || bIdx < 0) return null;
    return { cardId: card.id, target: aIdx, killTarget: bIdx };
  }
  if (rules.selfTarget) {
    // 桃/酒:自动以自己为目标
    const selfIdx = players.findIndex((p) => p.name === selfName);
    return { cardId: card.id, targets: [selfIdx >= 0 ? selfIdx : perspectiveIdx] };
  }
  if (rules.needsTarget) {
    if (!selectedTarget) return null;
    const idx = players.findIndex((p) => p.name === selectedTarget);
    if (idx < 0) return null;
    // 延时锦囊 validate 用单数 target;其他牌用 targets 数组
    if (card.type === '锦囊牌' && card.trickSubtype === '延时锦囊') {
      return { cardId: card.id, target: idx };
    }
    return { cardId: card.id, targets: [idx] };
  }
  // 无目标牌(无中生有/桃园结义/装备等)
  return { cardId: card.id };
}

// ─── distribute cardIds 解析 ───

/**
 * 解析 distribute 主动技的可选牌列表。
 * 静态 cardIds 优先;其次按 source(hand / handAndEquip)动态取。
 */
export function resolveDistributeCardIds(
  prompt: DistributePrompt,
  hand: Card[],
  equipment: Partial<Record<string, string>>,
): string[] {
  if (Array.isArray(prompt.cardIds) && prompt.cardIds.length > 0) {
    return prompt.cardIds;
  }
  if (prompt.source === 'handAndEquip') {
    const equipIds = Object.values(equipment).filter((id): id is string => typeof id === 'string');
    return [...hand.map((c) => c.id), ...equipIds];
  }
  return hand.map((c) => c.id);
}

// ─── 出牌操作按钮可见性 ───
// 与 availableActions 结束回合条件、引擎 hasBlockingPending 对齐:
// 仅「自己回合 + 出牌阶段 + 无阻塞 pending」可自由出牌/结束回合。

type PendingBlocking = { isBlocking?: boolean } | null;

export type FreePlayWindowInput = {
  isMyTurn: boolean;
  phase: string;
  pending: PendingBlocking;
};

/** 是否处于可自由出牌窗口(非回应/弃牌等阻塞询问)。 */
export function isFreePlayWindow({ isMyTurn, phase, pending }: FreePlayWindowInput): boolean {
  if (!isMyTurn || phase !== '出牌') return false;
  if (pending && pending.isBlocking !== false) return false;
  return true;
}

/** 「结束回合」按钮:可操作且处于自由出牌窗口。 */
export function canShowEndTurnButton(
  opts: FreePlayWindowInput & { canOperate: boolean },
): boolean {
  return opts.canOperate && isFreePlayWindow(opts);
}

/** 「取消选择」按钮:已选手牌且处于自由出牌窗口。 */
export function canShowCancelSelectionButton(
  opts: FreePlayWindowInput & { selectedCardId: string | null },
): boolean {
  return !!opts.selectedCardId && isFreePlayWindow(opts);
}

// ─── 弧形布局 ───

/**
 * 座位环坐标:自己在底栏,其余玩家沿上半椭圆环绕,中央留给 CenterTable。
 * - 1 人:正上方
 * - 2–3 人:上半弧(不落侧翼过低)
 * - 4+ 人:椭圆环,左右也可落座
 * @param totalOthers 其他玩家人数(不含自己)
 * @param i 当前玩家在"其他玩家"序列中的下标(0-based)
 * @returns { leftPct, topPct } 百分比坐标(相对 battleField)
 */
export function arcLayout(totalOthers: number, i: number): { leftPct: number; topPct: number } {
  if (totalOthers <= 0) return { leftPct: 50, topPct: 20 };
  if (totalOthers === 1) return { leftPct: 50, topPct: 6 };

  const t = i / (totalOthers - 1);
  // 标准极角:0=右, π/2=上, π=左。人数多时两端更靠侧下,腾出顶部中央。
  const startAngle = totalOthers <= 3 ? Math.PI * 0.88 : Math.PI * 1.12;
  const endAngle = totalOthers <= 3 ? Math.PI * 0.12 : Math.PI * -0.12;
  const angle = startAngle + (endAngle - startAngle) * t;

  const rx = totalOthers <= 3 ? 38 : 44;
  const ry = totalOthers <= 3 ? 26 : 34;
  const cx = 50;
  const cy = totalOthers <= 3 ? 20 : 26;

  const leftPct = cx + rx * Math.cos(angle);
  const topPct = cy - ry * Math.sin(angle);
  return {
    leftPct: Math.min(94, Math.max(6, leftPct)),
    topPct: Math.min(52, Math.max(2, topPct)),
  };
}
