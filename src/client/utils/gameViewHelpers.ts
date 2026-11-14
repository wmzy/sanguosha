// src/client/utils/gameViewHelpers.ts
// GameView 相关纯函数(无 React 依赖)。从 GameView.tsx 提取。
//
// 这些函数封装"构造 action params"和"UI 布局计算"两类纯逻辑,
// 让组件/hook 专注于状态管理,函数专注于数据转换。

import type {
  ActionContext,
  ActionPrompt,
  Card,
  CardWrapper,
  GameView,
  Json,
  DistributePrompt,
  TargetFilter,
} from '../../engine/types';
import { getCardEffect } from '../../engine/skills/cards';
import { 基本牌列表, 锦囊牌列表, 装备牌列表 } from '../../engine/data/card-defs';
import { TRANSFORM_ACTION_PREFIX } from '../../engine/util/declaredActionType';
import type { SkillActionDef } from '../skillActionRegistry';
import { defaultPlayActive } from '../../engine/rules/action-active';
import { validateTargetSelection } from '../../engine/rules/target-selection';

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
export function hasUseEntry(card: Pick<Card, 'name'>): boolean {
  const effect = getCardEffect(card.name);
  // 已注册 card-effect:看 timing;未注册(装备等):默认有 use 入口(乐观)。
  return effect ? effect.timing !== '生效前' : true;
}

/** 不属于"出牌阶段替代出牌方式"的 actionType 判定。
 *  respond=被动回应(pending 驱动);
 *  transform=转化技(transformMode 入口);distribute=分配(distributeMode 入口)。
 *  另有声明型转化技的 actionType 前缀族 `transform:杀`/`transform:桃`…(界矫诏/界渐营
 *  每个声明牌名注册一个 action)——同样各有 transformMode 交互入口,不作 altAction。
 *  这些均有各自的交互入口,不应在选中牌后作为 altAction 按钮重复出现。
 *  use 不排除:同一张牌可能被多个 use action 匹配(如黑杀同时匹配"杀"和"断粮"),
 *  主 use action(findUseActionForCard 返回)作为主按钮,其余 use action 作为
 *  替代出牌方式出现——这正是断粮/界断粮等转化类主动技的 UI 入口。 */
const NON_ALT_ACTION_TYPES = new Set(['respond', 'transform', 'distribute']);

/** actionType 是否属于"有独立交互入口、不作 altAction"的类型(集合 + transform: 前缀族)。 */
function isNonAltActionType(actionType: string): boolean {
  return NON_ALT_ACTION_TYPES.has(actionType) || actionType.startsWith(TRANSFORM_ACTION_PREFIX);
}

/**
 * 找出适用于指定卡牌的替代出牌动作(如铁索连环·重铸)。
 * 仅匹配真正的"出牌阶段替代出牌方式"(recast 等),排除 use/respond/transform/distribute
 * 及 transform: 前缀族——后者各有独立交互入口。避免选中桃后误出"出桃/respond""火攻/respond"等按钮。
 * @param actions 候选 action 集合
 * @param card   当前选中的卡牌
 */
export function findAltActionsForCard(
  actions: SkillActionDef[],
  card: Card,
  primaryAction?: SkillActionDef,
): SkillActionDef[] {
  return actions.filter((a) => {
    if (isNonAltActionType(a.actionType)) return false;
    // 排除主 use action(避免与主按钮重复);非 use 类型不受影响(primaryAction 为 undefined)
    if (primaryAction && a === primaryAction) return false;
    const filter = extractCardFilter(a.prompt);
    return filter ? filter(card) : false;
  });
}

// ─── 转化技(transform)共享判据:影子 id / 原料解析 / 组合约束 / 方向与产出牌门 ───

/** 转化技影子卡 id:`${选中牌 id 以 # 连接}#${skillId}`(与引擎转化 execute 的 shadowIdOf 同约定)。
 *  浏览器 usePlayInteraction 与无头 availableActions 构造主 action 的 cardId 必须用同一拼接,
 *  否则主 action 读不到 cardMap[影子 id] → validate 恒失败,该转化技整类不可用。 */
export function buildShadowCardId(ids: string | string[], skillId: string): string {
  const joined = Array.isArray(ids) ? ids.join('#') : ids;
  return `${joined}#${skillId}`;
}

/** 手牌 ∪ 自己装备区 的 id → Card 解析(界父魂/界武圣/奇袭 的转化原料含装备区牌)。 */
export function resolveOwnCard(
  hand: Card[] | undefined | null,
  equipment: Partial<Record<string, string | null>> | undefined,
  cardMap: GameView['cardMap'],
  id: string,
): Card | undefined {
  const inHand = hand?.find((c) => c.id === id);
  if (inHand) return inHand;
  const inEquip = Object.values(equipment ?? {}).some((equipId) => equipId === id);
  return inEquip ? cardMap[id] : undefined;
}

/** 自己装备区的牌(id → cardMap 解析,可选过滤)。转化原料(界武圣/界父魂)与
 *  代价牌(强袭·弃武器)的装备区解析统一走此函数,不再各自手写
 *  `Object.values(equipment).filter(string).map(cardMap)`。 */
export function ownEquipCards(
  equipment: Partial<Record<string, string | null>> | undefined,
  cardMap: GameView['cardMap'],
  filter?: (c: Card) => boolean,
): Card[] {
  const equipIds = Object.values(equipment ?? {}).filter((id): id is string => typeof id === 'string');
  return equipIds
    .map((id) => cardMap[id])
    .filter((c): c is Card => !!c && (!filter || filter(c)));
}

/** 自己的可用原料/代价牌:手牌匹配牌在前、装备区匹配牌在后(界父魂/界武圣/奇袭 的
 *  转化原料与 强袭·弃武器 的代价牌都含装备区)。三处消费同一判据:无头
 *  transformMaterialPool/costCardsOf 与浏览器 fillVariantCostCard。 */
export function ownMaterialCards(
  me: GameView['players'][number],
  view: GameView,
  filter: (c: Card) => boolean,
): Card[] {
  const hand = (me.hand ?? []).filter(filter);
  return [...hand, ...ownEquipCards(me.equipment, view.cardMap, filter)];
}

/** 多卡转化的组合约束校验(乱击/界乱击:两张同花色)。浏览器(提交前拦截)与
 *  无头(枚举过滤)同一判据:缺 comboFilter 时恒真(丈八蛇矛/界父魂 任意两张);
 *  某张 id 解析不到 Card(不在手牌∪装备区)时恒假。
 *  @param comboFilter prompt.cardFilter.comboFilter(「两张牌之间」的约束,单卡 filter 表达不了)
 *  @param resolveCard 原料牌解析(手牌 ∪ 自己装备区) */
export function comboSatisfied(
  comboFilter: ((cards: Card[]) => boolean) | undefined,
  resolveCard: (id: string) => Card | undefined,
  ids: string[],
): boolean {
  if (!comboFilter || ids.length === 0) return true;
  const cards: Card[] = [];
  for (const id of ids) {
    const card = resolveCard(id);
    if (!card) return false;
    cards.push(card);
  }
  return comboFilter(cards);
}

/** 转化方向求值:按一张具体原料牌求产出牌名(transform 回调)。
 *  多向转化技(龙胆 杀↔闪 / 界龙胆 杀/闪/酒/桃)的方向必须跟随**当前选中的牌**,
 *  按进入模式时的样本牌钉死方向会让另一方向的主 action 不存在(按钮消失)或方向不符(引擎拒)。 */
export function producedNameOf(
  transform: (card: Card) => CardWrapper,
  card: Card,
): string {
  return transform(card).name;
}

/** 产出牌的真实 CardDef(type/subtype),供转化动作查找同源 use action。
 *  不能沿用原料牌的 type:装备原料(青釭剑)+普通牌在丈八组合中若沿用
 *  type='装备牌',会先匹配「装备通用」而不是产出杀的 action,生成缺 targets 的坏动作。 */
const CARD_DEFS_BY_NAME = new Map(
  [...基本牌列表, ...锦囊牌列表, ...装备牌列表].map((def) => [def.name, def]),
);

/** 把原料牌包装成产出牌(名 + 真实 type/subtype),供 findUseActionForCard 匹配同源 use action。 */
export function asProducedCard(source: Card, outputName: string): Card {
  const def = CARD_DEFS_BY_NAME.get(outputName);
  return {
    ...source,
    name: outputName,
    ...(def ? { type: def.type, subtype: def.subtype } : {}),
  };
}

/** 从 use action 的 prompt 取 targetFilter(useCardAndTarget/selectTarget 才有)。 */
export function getTargetFilter(prompt: ActionPrompt): TargetFilter | null {
  if (prompt.type === 'useCardAndTarget' || prompt.type === 'selectTarget') {
    return prompt.targetFilter;
  }
  return null;
}

/** useCardAndTarget 的 selfTarget 标志(桃/酒自动以自己为目标)。 */
export function getSelfTarget(prompt: ActionPrompt): boolean {
  return prompt.type === 'useCardAndTarget' ? !!prompt.selfTarget : false;
}

/** isTriggerablePromptType 的端侧开关:转化类/distribute 是否纳入白名单。 */
export interface TriggerablePromptOptions {
  /** 转化类(useCard/useCardAndTarget 且 action.transform 存在)是否纳入 */
  transform?: boolean;
  /** distribute 类是否纳入 */
  distribute?: boolean;
}

/** triggerable prompt.type 白名单:浏览器技能按钮渲染(PlayerCardLarge)与无头
 *  主动技枚举(availableActions 的 enumeratePromptActions)的共享判据,此前两侧
 *  各手写一份集合。
 *  confirm/chooseOption/choosePlayer/selectTarget 两端一致纳入;转化类与 distribute
 *  由 opts 按端纳入——浏览器需要按钮进入转化选牌/分配模式,无头侧两者各有独立
 *  枚举器(transform/distribute 专用路径),不在此重复纳入,两侧现有行为严格等价。
 *  注意 opts.transform 传「该 action 是否携带 transform 回调」而非裸 true:无
 *  transform 的 use 型 prompt 是普通出牌路径(选手牌触发),不渲染为技能按钮。
 *  无 opts 重载是类型谓词:不带端侧开关时只有四种基础类型可通过,调用方(无头
 *  枚举)据此收窄 prompt;带 opts 时不承诺收窄(浏览器侧 filter 也不需要)。 */
export type BasicTriggerablePrompt = Extract<
  ActionPrompt,
  { type: 'confirm' | 'chooseOption' | 'choosePlayer' | 'selectTarget' }
>;

export function isTriggerablePromptType(prompt: ActionPrompt): prompt is BasicTriggerablePrompt;
export function isTriggerablePromptType(
  prompt: ActionPrompt,
  opts: TriggerablePromptOptions,
): boolean;
export function isTriggerablePromptType(
  prompt: ActionPrompt,
  opts?: TriggerablePromptOptions,
): boolean {
  switch (prompt.type) {
    case 'confirm':
    case 'chooseOption':
    case 'choosePlayer':
    case 'selectTarget':
      return true;
    case 'distribute':
      return !!opts?.distribute;
    case 'useCard':
    case 'useCardAndTarget':
      return !!opts?.transform;
    default:
      return false;
  }
}

/** 转化动作「产出牌门」+ 目标语义解析结果。produced 为 undefined 表示产出牌
 *  无注册 use action(回退 transform 自身的 targetFilter/rules)。 */
export interface ProducedTransformGate {
  /** 产出牌名(由 transform 回调按原料牌求值) */
  wrapperName: string;
  /** 产出牌自己的 use action(findUseActionForCard 按产出牌匹配) */
  produced: SkillActionDef | undefined;
  /** 目标语义:产出牌 use action 的 targetFilter,无时回退 transform 自身的 */
  targetFilter: TargetFilter | null;
  /** 目标规则:由产出牌 use action 派生,无时回退 transform 自身的 */
  rules: PlayRules;
}

/** 转化技「产出牌门」与目标语义解析(浏览器提交门与无头枚举门的共享判据):
 *  - 产出牌无主动 use 入口(闪/无懈可击 timing='生效前')或其 use action 未激活
 *    (桃 需已受伤)→ 返回 null(必拒动作:浏览器不得提交,无头不枚举);
 *  - 目标语义取**产出牌自己的 use action**(酒无目标 / 桃 selfTarget / 杀 攻击范围),
 *    而非 transform action 自身的 targetFilter(那是为原料牌方向设计的)。
 *  无头枚举的单卡/多卡分支原先各自复制一份此判据,现合并于此。 */
export function resolveProducedAction(
  skillActions: SkillActionDef[],
  action: SkillActionDef,
  sourceCard: Card,
  ctx: ActionContext,
): ProducedTransformGate | null {
  const transform = action.transform;
  if (!transform) return null;
  const wrapperName = producedNameOf(transform, sourceCard);
  if (!hasUseEntry({ name: wrapperName })) return null;
  const produced = findUseActionForCard(
    skillActions,
    asProducedCard(sourceCard, wrapperName),
  );
  if (produced && !isActiveAction(produced, ctx)) return null;
  const fallbackFilter = getTargetFilter(action.prompt);
  const targetFilter = produced ? getTargetFilter(produced.prompt) : fallbackFilter;
  const rules = produced
    ? derivePlayRules(targetFilter, getSelfTarget(produced.prompt))
    : derivePlayRules(fallbackFilter, getSelfTarget(action.prompt));
  return { wrapperName, produced, targetFilter, rules };
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
  const hasSlots = !!slots?.length;
  const slotCount = slots?.length ?? 0;
  const isSelf = !!selfTarget;
  const needsTarget = isSelf ? false : hasSlots || (targetFilter ? targetFilter.max >= 1 : false);
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
 * 由出牌规则(PlayRules,从 prompt 派生)决定 target/targets 字段；有序槽位统一 targets=[A,B]。
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
  view?: GameView,
): Record<string, Json> | null {
  const chosen = rules.hasSlots
    ? selectedMultiTargets.length ? selectedMultiTargets : [selectedTarget, selectedKillTarget].filter((name): name is string => name !== null)
    : rules.multiTarget ? selectedMultiTargets : selectedTarget ? [selectedTarget] : [];
  const indices = chosen.map((name) => players.findIndex((player) => player.name === name));
  if (rules.targetFilter && !rules.selfTarget && view &&
    !validateTargetSelection(view, perspectiveIdx, rules.targetFilter, indices, card)) return null;
  const selfName = players[perspectiveIdx]?.name ?? '';
  if (rules.hasSlots) {
    if (indices.length !== rules.slotCount || indices.some((index) => index < 0)) return null;
    return { cardId: card.id, targets: indices };
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

/** distribute allocate 模式可选目标:存活 + allowSelf(缺省允许分配给自己,见
 *  DistributePrompt.allowSelf 文档)+ targetFilter 三重判定。三处消费:无头
 *  enumerateDistributeActions 的 validTargets、浏览器 isTargetable 的逐座位
 *  可选性、distribute 子 hook 点座位 toggle——此前三处手写,且 allowSelf 缺省
 *  语义漂移(无头按文档默认允许,浏览器按 falsy 即排除)。 */
export function distributeAllocateCandidates(
  view: GameView,
  seatIdx: number,
  prompt: {
    allowSelf?: boolean;
    targetFilter?: (view: GameView, target: number) => boolean;
  },
): number[] {
  return view.players
    .filter((p) => p.alive
      && (p.index !== seatIdx || prompt.allowSelf !== false)
      && (!prompt.targetFilter || prompt.targetFilter(view, p.index)))
    .map((p) => p.index);
}

// ─── 主动技按钮的提交变体 ───

/** 主动技按钮的提交变体:一个 action 可能对应多个可点按钮。
 *  - selectTarget + prompt.paramVariants(强袭代价二选一「失去体力/弃武器」):
 *    每个变体一个按钮,点击时把变体 params(cost)并入提交参数——否则单按钮提交缺 cost,
 *    引擎 validate 恒拒(「cost 必须为 hp 或 discard」),技能在浏览器上无法发动。
 *  - chooseOption(决堰:废除哪个装备栏):每个选项一个按钮,点击即提交 `params.option`。
 *    与 pending 侧 AwaitingPrompt 的 chooseOption 渲染、无头 enumeratePromptActions 的
 *    展开同源(同一份 prompt.options)。此前浏览器既不在 triggerableActions 里收 chooseOption,
 *    也没有提交 option 的分支 → 整类主动技在浏览器不可达(只有 AI 客户端能用)。
 *  - 其余(confirm/choosePlayer/selectTarget 无变体):单个按钮,label 为空 = 用技能名作按钮文本。
 *  与无头客户端 enumeratePromptActions 的变体展开同源(同一份 prompt.paramVariants 声明)。 */
export function skillActionVariants(action: SkillActionDef): Array<{
  label: string;
  params: Record<string, Json>;
  cardFilter?: (card: Card) => boolean;
  /** 按钮 tooltip 用的补充说明(chooseOption 的选项效果文案) */
  description?: string;
}> {
  const prompt = action.prompt;
  if (prompt.type === 'selectTarget' && prompt.paramVariants?.length) {
    return prompt.paramVariants.map((v) => ({
      label: v.label,
      params: v.params,
      ...(v.cardFilter ? { cardFilter: v.cardFilter } : {}),
    }));
  }
  if (prompt.type === 'chooseOption') {
    // 按钮文本用短名(value),完整效果文案(label)进 tooltip —— 技能区是紧凑卡片,
    // 放不下「武器栏 — 使用杀的限制次数+3」这类长文案。
    return prompt.options.map((opt) => ({
      label: opt.value,
      params: { option: opt.value },
      description: opt.label,
    }));
  }
  return [{ label: '', params: {} }];
}

/** 主动技提交变体的完整展开:变体列表(skillActionVariants) × 变体声明的代价牌
 *  (手牌∪装备区匹配,ownMaterialCards)。三处消费同一份声明:浏览器按钮
 *  (skillActionVariants)、无头枚举(enumeratePromptActions 的 变体×代价牌×目标
 *  三重循环)、提交时补 cardId(fillVariantCostCard 的 equip 兜底)。
 *  无 cardFilter 的变体 costCards 为空数组(无代价牌)。 */
export function expandActionVariants(
  action: SkillActionDef,
  me: GameView['players'][number],
  view: GameView,
): Array<{
  label: string;
  params: Record<string, Json>;
  cardFilter?: (card: Card) => boolean;
  /** 按钮 tooltip 用的补充说明(chooseOption 的选项效果文案) */
  description?: string;
  /** 变体声明的代价牌(强袭·弃武器);无 cardFilter 时为空数组 */
  costCards: Card[];
}> {
  return skillActionVariants(action).map((v) => ({
    ...v,
    costCards: v.cardFilter ? ownMaterialCards(me, view, v.cardFilter) : [],
  }));
}

/** choosePlayer 候选解析:优先投影层下发的 candidates(filter 无法跨进程序列化,
 *  candidates 为权威),否则按 filter 过滤存活玩家。三处消费:无头
 *  enumeratePromptActions/appendRespondActions 的候选列表、浏览器 isTargetable
 *  的逐座位可选性判断。 */
export function choosePlayerCandidates(
  view: GameView,
  prompt: { candidates?: number[]; filter?: (view: GameView, target: number) => boolean },
): number[] {
  if (prompt.candidates) return prompt.candidates;
  return view.players
    .filter((p) => p.alive && (!prompt.filter || prompt.filter(view, p.index)))
    .map((p) => p.index);
}

/** selectTarget 候选解析:存活 + allowSelf + targetFilter.filter 三重判定
 *  (allowSelf 缺省排除自己,与 engine targetCandidates 的
 *  `target === ownerId && !filter.allowSelf` 同源)。两处消费:无头
 *  enumeratePromptActions 的候选列表、浏览器 isTargetable 的逐座位可选性判断
 *  ——此前无头侧只查存活+filter、漏 allowSelf 挡板,枚举出引擎必拒的自目标动作。 */
export function selectTargetCandidates(
  view: GameView,
  seatIdx: number,
  prompt: {
    targetFilter: {
      allowSelf?: boolean;
      filter?: (view: GameView, target: number) => boolean;
    };
  },
): number[] {
  const { allowSelf, filter } = prompt.targetFilter;
  return view.players
    .filter((p) => p.alive
      && (p.index !== seatIdx || !!allowSelf)
      && (!filter || filter(view, p.index)))
    .map((p) => p.index);
}

/** 主动技目标数上下界:selectTarget/useCardAndTarget 读 targetFilter.min/max、
 *  choosePlayer 读 prompt.min/max,缺省均为 1(其余 prompt 类型亦 {1,1})。
 *  消费方:浏览器 handleTargetClick(单选点座位即提交)、handleSkillAction(未选目标
 *  先进入待定选目标模式)、无头 enumeratePromptActions(minTarget/maxTarget 投影与
 *  多选描述性 action 边界)及出牌/转化路径的 targetBoundsOf(use 型 prompt 的
 *  minTarget/maxTarget 投影,如铁索连环 max 2、杀 max 3)——useCardAndTarget 分支
 *  补齐前,use 路径只能私有一份 targetFilter 手写镜像。 */
export function promptTargetBounds(prompt: ActionPrompt): { min: number; max: number } {
  if (prompt.type === 'selectTarget' || prompt.type === 'useCardAndTarget') {
    return { min: prompt.targetFilter.min ?? 1, max: prompt.targetFilter.max ?? 1 };
  }
  if (prompt.type === 'choosePlayer') {
    return { min: prompt.min ?? 1, max: prompt.max ?? 1 };
  }
  return { min: 1, max: 1 };
}

/** 目标约束的 card 参数(杀的动态目标上限解释):选中牌只在「就是正在使用的牌」
 *  时才有意义——调用方通过 usedCardName 显式声明:
 *   · 无 targetFilter(use 型 prompt):选中牌就是正在使用的牌,内部自动认定;
 *   · 转化技:传产出牌名(transformWrapperName,武圣 红牌当杀);
 *   · 普通出牌:调用方确认「选中牌就是本 action 使用的牌」后传其牌名
 *     (浏览器按 selectedUseAction.skillId === 选中牌名,无头按 牌名 === skillId);
 *   · 技能代价牌(离间 弃一张牌 + 选两名男性、强袭 弃武器)传 null——代价牌
 *     不能按杀的动态目标上限解释(否则 min=max=2 塌成 1,永远提交不出合法
 *     目标数,见 target-selection.ts 的 countsAsSlash 契约)→ 返回 undefined。
 *  此前浏览器 isTargetable 与无头 availableActions 各持一份启发式(后者按
 *  preceding/动作名===牌名 判定),现统一:helper 只认调用方的 usedCardName
 *  声明,不再自行猜测「牌名===杀」(代价牌恰好是杀时会被误判)。 */
export function effectiveTargetCard(
  selectedCard: Card | null | undefined,
  selectedTargetFilter: TargetFilter | null | undefined,
  usedCardName: string | null | undefined,
): Card | undefined {
  const usingSelected = !selectedTargetFilter || usedCardName != null;
  return selectedCard && usingSelected
    ? { ...selectedCard, name: usedCardName ?? selectedCard.name }
    : undefined;
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

/** view 根 pending 是否为阻塞型(默认阻塞,isBlocking===false 才是非阻塞)。
 *  isFreePlayWindow 与 PlayerCardLarge 的 memo comparator 共用(此前后者私有
 *  重复实现,注释自认与 isFreePlayWindow 同源)。 */
export function hasBlockingPending(pending: PendingBlocking): boolean {
  return pending != null && pending.isBlocking !== false;
}

/** 是否处于可自由出牌窗口(非回应/弃牌等阻塞询问)。 */
export function isFreePlayWindow({ isMyTurn, phase, pending }: FreePlayWindowInput): boolean {
  if (!isMyTurn || phase !== '出牌') return false;
  return !hasBlockingPending(pending);
}

/** 「结束回合」按钮:可操作且处于自由出牌窗口。 */
export function canShowEndTurnButton(opts: FreePlayWindowInput & { canOperate: boolean }): boolean {
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
// 排列按逆时针环序(与座次行动顺序一致):从自己下家的右侧位开始,沿右缘向上、
// 横穿顶排、再沿左缘向下。约束:座位块高约 38%(名牌 26+卡 200+标签 40 ≈ 266px),
// 同列相邻座 top 差需 ≥40% 防重叠;左列 left=6%、右列 ≥92%,避开中央操作坞
// (x∈[32.5,67.5]);左下列 top ≤52%——块底 52%+38%=90%,须让出左下角
// zoneCornerHud(layout.ts:bottom 10px+高约 60px ≈ 战场底部 10%),故 6/7
// 人局左列纵排取 12/52(差 40% 防重叠,12 亦不与顶排横列碰撞——座位宽约
// 158px < 左列右缘到顶排左座的间距)。
const ARC_PRESETS: Record<number, Array<[number, number]>> = {
  1: [[50, 1]],
  // 2(3人局):两对手分居左右中位(p0),主公概念上在顶中;i=0 为右侧下家
  2: [
    [89, 34],
    [9, 34],
  ],
  // 3:顶排三连
  3: [
    [85, 1],
    [50, 0],
    [15, 1],
  ],
  // 4:右中 → 顶右 → 顶左 → 左中
  4: [
    [92, 22],
    [80, 1],
    [20, 1],
    [6, 24],
  ],
  // 5:右中 → 顶排三 → 左中
  5: [
    [92, 24],
    [78, 1],
    [50, 0],
    [22, 1],
    [6, 26],
  ],
  // 6:右中 → 顶右 → 顶中 → 顶左 → 左上 → 左下(自己概念上在右下)
  6: [
    [93, 20],
    [74, 1],
    [50, 0],
    [26, 1],
    [6, 12],
    [6, 52],
  ],
  // 7:右纵列两座 → 顶排三 → 左纵列两座
  7: [
    [93, 58],
    [93, 18],
    [72, 1],
    [50, 0],
    [28, 1],
    [6, 12],
    [6, 52],
  ],
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
