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
import { getCardEffect } from '../../engine/skills/cards';
import type { SkillActionDef } from '../skillActionRegistry';
import { defaultPlayActive } from '../../engine/rules/action-active';

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

/** 判断一张牌是否有主动 use 入口(可否在出牌阶段主动打出)。
 *  基于 CardEffect 注册表(静态,eager load),不依赖动态注册的 skillActions——
 *  因此在 useSkillActions 异步注册间隙也能给出稳定答案,避免手牌闪烁。
 *
 *  timing='生效前' 的纯回应牌(闪/无懈可击)只有 respond 入口,无主动 use,在出牌阶段
 *  不可主动打出;其余基本牌/锦囊(timing='出牌阶段')以及未注册 card-effect 的牌
 *  (装备牌由「装备通用」注册 use)均有 use 入口。
 *  与 use-card onMount 跳过 timing='生效前' 的逻辑同源。 */
export function hasUseEntry(card: Card): boolean {
  const effect = getCardEffect(card.name);
  // 已注册 card-effect:看 timing;未注册(装备等):默认有 use 入口(乐观)。
  return effect ? effect.timing !== '生效前' : true;
}

/** 不属于"出牌阶段替代出牌方式"的 actionType 集合。
 *  respond=被动回应(pending 驱动);
 *  transform=转化技(transformMode 入口);distribute=分配(distributeMode 入口)。
 *  这些均有各自的交互入口,不应在选中牌后作为 altAction 按钮重复出现。
 *  use 不排除:同一张牌可能被多个 use action 匹配(如黑杀同时匹配"杀"和"断粮"),
 *  主 use action(findUseActionForCard 返回)作为主按钮,其余 use action 作为
 *  替代出牌方式出现——这正是断粮/界断粮等转化类主动技的 UI 入口。 */
const NON_ALT_ACTION_TYPES = new Set(['respond', 'transform', 'distribute']);

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
  primaryAction?: SkillActionDef,
): SkillActionDef[] {
  return actions.filter((a) => {
    if (NON_ALT_ACTION_TYPES.has(a.actionType)) return false;
    // 排除主 use action(避免与主按钮重复);非 use 类型不受影响(primaryAction 为 undefined)
    if (primaryAction && a === primaryAction) return false;
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
  /** 是否多目标(非槽位、max>=2,如铁索连环 1-2 人、杀 max 3):点击多目标累加为一个集合 */
  multiTarget: boolean;
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
  const isSelf = !!selfTarget;
  const needsTarget = isSelf
    ? false
    : hasSlots || (targetFilter ? targetFilter.max >= 1 : false);
  // 多目标:非槽位、非自动自身、targetFilter.max>=2(铁索连环/可多目标的杀)。
  // 这类卡牌点击目标为「累加到一个集合」而非单选/分槽位。
  const multiTarget = !hasSlots && !isSelf && (targetFilter?.max ?? 0) >= 2;
  return {
    needsTarget,
    hasSlots,
    slotCount,
    selfTarget: isSelf,
    multiTarget,
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
  /** 多目标(铁索连环等)已选目标 name 集合;单/槽位路径忽略 */
  selectedMultiTargets: string[] = [],
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
  if (rules.multiTarget) {
    // 铁索连环等:1..max 个同质目标,产出 targets 数组
    const min = rules.targetFilter?.min ?? 1;
    if (selectedMultiTargets.length < min) return null;
    const idxs = selectedMultiTargets
      .map((n) => players.findIndex((p) => p.name === n))
      .filter((i): i is number => i >= 0);
    if (idxs.length < min) return null;
    return { cardId: card.id, targets: idxs };
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

// ─── 座位 DOM 查询 ───

/** 简单 CSS escape:仅处理常见特殊字符,避免引入 full CSS.escape polyfill。 */
function cssEscape(s: string): string {
  return s.replace(/["\\\]]/g, '\\$&');
}

/** 查询座次对应 DOM 元素:优先 data-player-name 精确匹配。
 *  PlayerSeatView 与 PlayerCardLarge 都已加 data-player-name=player.name。 */
export function findSeatEl(view: GameView, idx: number): HTMLElement | null {
  const p = view.players.find((q) => q.index === idx);
  if (!p) return null;
  return document.querySelector<HTMLElement>(`[data-player-name="${cssEscape(p.name)}"]`);
}

/** 查询座次中心点(viewport 坐标),供定位型浮层/特效使用。找不到返回 null。 */
export function findSeatCenter(view: GameView, idx: number): { left: number; top: number } | null {
  const el = findSeatEl(view, idx);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left + r.width / 2, top: r.top + r.height / 2 };
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
/** 将卡牌名 + 伤害属性转为面向玩家的显示名。
 *  杀 + 火焰 → 火杀;杀 + 雷电 → 雷杀;其余原样返回。 */
export function displayCardName(name: string, damageType?: string): string {
  if (name === '杀') {
    if (damageType === '火焰') return '火杀';
    if (damageType === '雷电') return '雷杀';
  }
  return name;
}

// 官方 OL 式预设座次位表(战场区百分比):[leftPct, topPct]。
// 结构 = 上排横列 + 左右两侧纵列(官方 7 人局:上 3、中左右 2、下左右 2,自己固定右下)。
// 排列按逆时针环序(与座次行动顺序一致):从自己上家的右侧位开始,沿右缘向上、
// 横穿顶排、再沿左缘向下。约束:座位块高约 38%(名牌 26+卡 200+标签 40 ≈ 266px),
// 同列相邻座 top 差需 ≥40% 防重叠;左列 left=6%、右列 ≥92%,避开中央操作坞
// (x∈[32.5,67.5]);左下列 top ≤52%——块底 52%+38%=90%,须让出左下角
// zoneCornerHud(layout.ts:bottom 10px+高约 60px ≈ 战场底部 10%),故 6/7
// 人局左列纵排取 12/52(差 40% 防重叠,12 亦不与顶排横列碰撞——座位宽约
// 158px < 左列右缘到顶排左座的间距)。
const ARC_PRESETS: Record<number, Array<[number, number]>> = {
  1: [[50, 1]],
  // 2(3人局):两对手分居左右中位(p0),主公概念上在顶中;i=0 为右侧下家
  2: [[89, 34], [9, 34]],
  // 3:顶排三连
  3: [[85, 1], [50, 0], [15, 1]],
  // 4:右中 → 顶右 → 顶左 → 左中
  4: [[92, 22], [80, 1], [20, 1], [6, 24]],
  // 5:右中 → 顶排三 → 左中
  5: [[92, 24], [78, 1], [50, 0], [22, 1], [6, 26]],
  // 6:右中 → 顶右 → 顶中 → 顶左 → 左上 → 左下(自己概念上在右下)
  6: [[93, 20], [74, 1], [50, 0], [26, 1], [6, 12], [6, 52]],
  // 7:右纵列两座 → 顶排三 → 左纵列两座
  7: [[93, 58], [93, 18], [72, 1], [50, 0], [28, 1], [6, 12], [6, 52]],
};

export function arcLayout(totalOthers: number, i: number): { leftPct: number; topPct: number } {
  if (totalOthers <= 0) return { leftPct: 50, topPct: 1 };
  const preset = ARC_PRESETS[totalOthers];
  if (preset?.[i]) return { leftPct: preset[i][0], topPct: preset[i][1] };
  if (totalOthers === 1) return { leftPct: 50, topPct: 1 };

  const t = i / (totalOthers - 1);
  // 超出预设表的更多人数:回退均匀上半弧(极角:0=右, π/2=上, π=左)。
  const startAngle = Math.PI;
  const endAngle = 0;
  const angle = startAngle + (endAngle - startAngle) * t;

  const rx = 44;
  // ry = cy - 1:最高点(弧顶)恰好贴近顶部(topPct≈1%),整体上移让武将卡尽量靠顶
  const cx = 50;
  const cy = 19;
  const ry = cy - 1;

  const leftPct = cx + rx * Math.cos(angle);
  const topPct = cy - ry * Math.sin(angle);
  return {
    leftPct: Math.min(94, Math.max(3, leftPct)),
    topPct: Math.min(62, Math.max(0.5, topPct)),
  };
}
