// src/engine/util/skillRuntime/misc.ts — 出牌时机判定、被询问杀窗口、params 选牌/目标归一、
// confirm 型 defineAction。
// (自 util/skillRuntime.ts 按内聚拆出;导出经桶文件 skillRuntime.ts re-export,调用方零改动。)
// 已迁出的同类样板:runVirtualSlash → skills/cards/_virtualSlash.ts(util 不得反向
// 依赖 skills 层);slotOf → util/equip-slot.ts;玩家状态判定族 → util/player-query.ts。
// 命名:函数/类型英文;业务字面量(错误文案/按钮文案)保持中文。
import type {
  ActionActiveWhen,
  ActionContext,
  FrontendAPI,
  GameState,
  Json,
  PickProcessingCardPrompt,
  Skill,
} from '../../types';
import { hasBlockingPending } from '../../core/skill';

// ────────────────────────── 出牌时机四合一 ──────────────────────────

/** 引擎侧「现在可以主动出牌/用技」四合一:自己回合 + 出牌阶段 + 无阻塞 pending + 存活。
 *  与 view 侧 rules/action-active.ts 的 defaultPlayActive 语义同源(那边不查存活,
 *  由按钮渲染层兜底);各转化技 validate 里逐字复制的五连判收敛于此。
 *  需要向调用方/前端给出具体不满足原因时用 engineCanPlayNowReason。 */
export function engineCanPlayNow(state: GameState, ownerId: number): boolean {
  return engineCanPlayNowReason(state, ownerId) === null;
}

/** engineCanPlayNow 的原因版:返回首个未满足条件的标准中文错误(顺序:玩家不存在/
 *  已死亡 → 非本人回合 → 非出牌阶段 → 有阻塞 pending),全部满足返回 null。
 *  错误文案沿用项目现有习惯(义绝/界明策 等 use validate)。 */
export function engineCanPlayNowReason(state: GameState, ownerId: number): string | null {
  const p = state.players[ownerId];
  if (!p) return '玩家不存在或已死亡';
  if (!p.alive) return '你已死亡';
  if (state.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
  if (state.phase !== '出牌') return '只能在出牌阶段使用';
  if (hasBlockingPending(state)) return '当前有未完成的询问';
  return null;
}

// ────────────────────────── 被询问杀窗口判定 ──────────────────────────

/** pending slot 是否为「被询问出杀」窗口:
 *  直接询问(atom 询问杀,南蛮入侵/决斗)或委托回应(请求回应 + requestType='杀/respondKill',
 *  激将/挑衅)。与 cards/杀.ts respond 的 pending 判定同构;是否问的是本人由调用方比对 target。 */
export function isAskedKillSlot(
  slot: { atom?: unknown } | undefined | null,
): boolean {
  const atom = slot?.atom as { type?: string; requestType?: string } | undefined;
  if (!atom) return false;
  return (
    atom.type === '询问杀' ||
    (atom.type === '请求回应' && atom.requestType === '杀/respondKill')
  );
}

/** view 侧同源判定:当前视角是否被询问出杀(onMount activeWhen 的回应路径维度)。 */
export function viewAskedKill(ctx: ActionContext): boolean {
  const slot = ctx.view.pending;
  return (
    !!slot && slot.target === ctx.perspectiveIdx && isAskedKillSlot(slot)
  );
}

/** view 侧同源判定:当前视角是否被询问闪(onMount activeWhen 的防御向回应路径维度)。
 *  「询问闪」均为直接询问,无 委托回应 变体(对比杀的 请求回应+requestType),故只查 atom.type。 */
export function viewAskedDodge(ctx: ActionContext): boolean {
  const slot = ctx.view.pending;
  return (
    !!slot &&
    slot.target === ctx.perspectiveIdx &&
    (slot.atom as { type?: string } | null)?.type === '询问闪'
  );
}

// ────────────────────────── params 选牌读取归一 ──────────────────────────

/**
 * params 选牌归一:cardIds 数组优先,单数 cardId 兜底成数组;均无 → []。
 * 前端两种 wire 形状(面板多选发 cardIds、handlePlayCard 单选发 cardId)的
 * 逐字读取样板收敛(此前 制衡/神速/恸哭 等 validate 与 execute 各自手抄)。
 * 不校验成员类型/去重/归属——与手写现状一致,由调用方 validate 自行检查。
 *
 * 用法(validate/execute 共用同一读取,保证两侧一致):
 * ```ts
 * const cardIds = normalizeCardIds(params);
 * if (cardIds.length === 0) return 'cardIds required (at least 1)';
 * if (new Set(cardIds).size !== cardIds.length) return 'cardIds 含重复牌';
 * ```
 */
export function normalizeCardIds(params: Record<string, Json>): string[] {
  const ids = params['cardIds'];
  if (Array.isArray(ids)) return ids as string[];
  const single = params['cardId'];
  return typeof single === 'string' ? [single] : [];
}

/**
 * params 单卡读取:cardIds[0] 优先,回落单数 cardId;均无 → undefined。
 * 「distribute/select 面板可能发数组、单选路径可能发单数」的技能读取样板收敛
 * (神速 opt2-equip 等的 `params.cardIds?.[0] ?? params.cardId` 变体)。
 *
 * 用法:
 * ```ts
 * const equipCardId = firstCardId(params);
 * if (!equipCardId) return '需要选择一张装备牌';
 * ```
 */
export function firstCardId(params: Record<string, Json>): string | undefined {
  const ids = params['cardIds'];
  if (Array.isArray(ids) && ids.length > 0) return ids[0] as string;
  const single = params['cardId'];
  return typeof single === 'string' ? single : undefined;
}

/**
 * params 单目标读取:normalizeCardIds/firstCardId 的 target 类比物——
 * `targets[0]` 优先,回落单数 `target`;均无/非数字 → undefined。
 * 与 CLAUDE.md「目标形状归一(dispatch 边界)」对齐:客户端两种 wire 形状
 * (普通牌/技能代价牌发 `targets:[idx]`、延时锦囊发 `target:idx`),dispatch 入口
 * 的 normalizeTargetShape(core/index.ts)按「已有值不互相覆盖、单数取 targets[0]」
 * 补齐——本函数以同一优先级读取,故 dispatch 已归一后的 params 读到的就是权威值。
 * 「distribute/select 面板发数组、延时锦囊单选路径发单数」的单目标技能读取样板收敛
 * (桃/酒/_delayedSkipEffect 等的 `target ?? targets?.[0]` 变体)。
 *
 * 用法:
 * ```ts
 * const target = firstTarget(params);
 * if (target === undefined) return '需要指定目标';
 * ```
 */
export function firstTarget(params: {
  target?: unknown;
  targets?: unknown;
}): number | undefined {
  const t = params.targets;
  const first = Array.isArray(t) ? t[0] : undefined;
  const solo = typeof params.target === 'number' ? params.target : undefined;
  return typeof first === 'number' ? first : solo;
}

// ────────────────────────── 摸牌阶段守卫 ──────────────────────────

/** 摸牌 before-hook 的「自己回合摸牌阶段的常规摸牌」四连守卫:
 *  atom.player=自己 + 当前玩家=自己 + phase='摸牌' + 自己存活。
 *  英姿/裸衣/界英姿/界突袭/好施/庸肆/界自守 等摸牌阶段触发技的公共判定——
 *  排除无中生有/遗计/苦肉等其他摸牌路径;漏任一条件会误触发(见各技能文件头注释)。 */
export function isOwnDrawPhaseDraw(
  ctx: { atom: { player?: number }; state: GameState },
  ownerId: number,
): boolean {
  if (ctx.atom.player !== ownerId) return false;
  if (ctx.state.currentPlayerIndex !== ownerId) return false;
  if (ctx.state.phase !== '摸牌') return false;
  return ctx.state.players[ownerId]?.alive === true;
}

// ────────────────────────── prompt 卡牌列表映射 ──────────────────────────

/** cardIds → pickProcessingCard/useCard prompt 的 cards 列表映射
 *  (cardMap 查面 + 未知 id 剔除)。义绝/界潜袭/攻心/飞军/五谷丰登 等
 *  「列明候选牌给玩家点选」的公共样板;返回值直接作 prompt.cards。 */
export function toPromptCards(
  state: GameState,
  cardIds: readonly string[],
): PickProcessingCardPrompt['cards'] {
  const cards: PickProcessingCardPrompt['cards'] = [];
  for (const id of cardIds) {
    const c = state.cardMap[id];
    if (!c) continue;
    cards.push({ cardId: id, cardName: c.name, suit: c.suit, rank: c.rank });
  }
  return cards;
}

// ────────────────────────── confirm 型 defineAction 样板 ──────────────────────────

/** defineConfirmAction 可选项(label/title 必填,其余可选,缺省只兜底不覆盖显式传入)。 */
export interface ConfirmActionOptions {
  /** 按钮文案(defineAction.label)。 */
  label: string;
  /** 弹窗标题(prompt.title)。 */
  title: string;
  /** 弹窗补充说明(prompt.description)。 */
  description?: string;
  /** 确认按钮文案,默认 '发动'。仅是默认值——界求援 '给牌'/界灭计 '弃一张锦囊'/界渐营
   *  '摸一张' 等文案不同的技能显式传入,按传入渲染。 */
  confirmLabel?: string;
  /** 取消按钮文案,默认 '不发动'。 */
  cancelLabel?: string;
  /** 按钮样式,默认 'primary'。 */
  style?: 'primary' | 'danger' | 'default' | 'passive';
  /** 禁用确认按钮(prompt.confirmDisabled,如界狂骨满血时"回复体力"分支)。 */
  confirmDisabled?: boolean;
  /** 激活谓词(defineAction.activeWhen,如乱武/据守/界甘露 的 defaultPlayActive /
   *  activeUnlessUsedThisTurn)。缺省不传,沿用前端集中实现的缺省语义。 */
  activeWhen?: ActionActiveWhen;
  /** respond action 服务的 pending requestType(defineAction.respondFor,
   *  如界醇醪 '桃/求桃')。缺省不传。 */
  respondFor?: string;
}

/**
 * onMount 侧 confirm 型 defineAction 样板:
 * `api.defineAction(actionName, {label, style:'primary', prompt:{type:'confirm',
 * title, confirmLabel:'发动', cancelLabel:'不发动'}})`。
 * 约 150 处 confirm 型 onMount 逐字复制收敛于此;label/title 必填,
 * confirmLabel/cancelLabel/style/description/confirmDisabled 可覆盖默认,
 * activeWhen(激活谓词)/respondFor(respond 服务的 pending requestType)透传。
 *
 * 用法(标准 发动/不发动):
 * ```ts
 * export function onMount(_skill: Skill, api: FrontendAPI): void {
 *   defineConfirmAction(api, 'respond', { label: '突袭', title: '是否发动突袭?' });
 * }
 * ```
 *
 * 用法(自定义文案/样式):
 * ```ts
 * defineConfirmAction(api, 'respond', {
 *   label: DISPLAY_NAME,
 *   title: '灭计:选择一项',
 *   description: '1.弃置一张锦囊牌;2.依次弃置两张牌',
 *   confirmLabel: '弃一张锦囊',
 *   cancelLabel: '依次弃两张',
 *   style: 'default',
 * });
 * ```
 */
export function defineConfirmAction(
  api: FrontendAPI,
  actionName: string,
  opts: ConfirmActionOptions,
): void {
  api.defineAction(actionName, {
    label: opts.label,
    style: opts.style ?? 'primary',
    ...(opts.activeWhen !== undefined ? { activeWhen: opts.activeWhen } : {}),
    ...(opts.respondFor !== undefined ? { respondFor: opts.respondFor } : {}),
    prompt: {
      type: 'confirm',
      title: opts.title,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      confirmLabel: opts.confirmLabel ?? '发动',
      cancelLabel: opts.cancelLabel ?? '不发动',
      ...(opts.confirmDisabled !== undefined ? { confirmDisabled: opts.confirmDisabled } : {}),
    },
  });
}

/** defineConfirmAction 的 onMount 整体替换版:返回值可直接作 `SkillModule.onMount`
 *  (void 返回是 `(() => void) | void` 的子集)。收敛约 36 个技能文件里
 *  「onMount 函数体整体只有一次 defineConfirmAction 调用」的样板——这类文件不再
 *  手写空壳函数,onMount 直接等于工厂返回值;onMount 内还有其他注册逻辑
 *  (多 action/事件监听)的技能仍内联调用 defineConfirmAction。
 *  参数与 defineConfirmAction 后两参一致(actionName + opts)。
 *
 * 用法:
 * ```ts
 * export const onMount = makeConfirmMount('respond', {
 *   label: DISPLAY_NAME,
 *   title: '是否发动突袭?',
 * });
 * ```
 */
export function makeConfirmMount(
  actionName: string,
  opts: ConfirmActionOptions,
): (skill: Skill, api: FrontendAPI) => void {
  return (_skill: Skill, api: FrontendAPI) => {
    defineConfirmAction(api, actionName, opts);
  };
}
