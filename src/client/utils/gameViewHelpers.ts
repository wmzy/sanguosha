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

// ─── 弧形布局 ───

/**
 * 弧形座位坐标计算。
 * 沿 180° 弧形分布:左端 5%,右端 95%;Y 轴弧线中间高两端低。
 * @param totalOthers 其他玩家人数(不含自己)
 * @param i 当前玩家在"其他玩家"序列中的下标(0-based)
 * @returns { leftPct, topPct } 百分比坐标
 */
export function arcLayout(totalOthers: number, i: number): { leftPct: number; topPct: number } {
  const t = totalOthers <= 1 ? 0.5 : i / (totalOthers - 1);
  const leftPct = 5 + 90 * t;
  const arcH = 1 - Math.cos(Math.PI * t); // 0→1→0
  const topPct = 55 - 52 * arcH * 0.5;
  return { leftPct, topPct };
}
