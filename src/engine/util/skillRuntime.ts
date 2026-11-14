// src/engine/util/skillRuntime.ts — 技能运行期共享小助手。
// 收敛 skills/ 下逐字复制的九类样板(SkillMicro + SkillRespond 共享本文件,改导出名前先协调):
//   1) runVirtualSlash:7 处"视为出杀"结算(界乱武/界仁德/界惴恐/界明策/界求援/界神速/神速);
//   2) requireRequestType:respond validate 的「读 pending slot → 断言 请求回应 → 比对 requestType」三连;
//   3) currentRequestType:读座次当前 pending 的 requestType(14 处局部副本,3 种 as 断言
//      变体统一为最严格一种:直接 as { requestType?: string },编译器校验可比性);
//   4) slotOf:装备牌 subtype → 装备栏位(与 装备 atom 的 inferSlot 一致,7+2 处副本);
//   5) effectiveCardId:转化影子卡 → shadowOf 原卡 id(奸雄/界奸雄/界双雄/恃才/立军
//      追迹伤害牌/使用牌时的同一内联表达式);
//   6) engineCanPlayNow/isAskedKillSlot/viewAskedKill:转化技 validate 与 activeWhen
//      的五连判(时机四合一 + 被询问杀窗口);
//   7) registerTransformAction/mountTransformAction:转化技五件套工厂(16 文件收敛,
//      见下方「转化技统一注册」段注释);
//   8) registerConfirmRespond:confirm 型 respond 三件套(requireRequestType 校验 +
//      写 localVars 确认键 + 错误文案);
//   9) askConfirm:confirm 型询问三段(delete 确认键残值 → applyAtom(请求回应/confirm)
//      → 读确认键;超时未设键按 defaultChoice 兜底);
//  10) normalizeCardIds/firstCardId:params 选牌读取归一(cardIds 数组优先,单数 cardId 兜底);
//  11) registerOnOwnSlashDodged:「自己使用的杀被闪抵消」前导守卫 after-hook
//      (贯石斧/青龙偃月刀/界咆哮/界空城 四处时机一致,均为 '被抵消' after);
//  12) defineConfirmAction:confirm 型 defineAction 的 onMount 样板(默认 发动/不发动/primary,
//      显式传入不覆盖);
//  13) registerPhaseStartHook:「阶段开始」before-hook 前导三查(type/player/phase 归属)。
// 命名:函数/类型英文;业务字面量(牌名 '杀'/atom 类型 '请求回应'/错误文案)保持中文。
import type {
  ActionActiveWhen,
  ActionContext,
  ActionPrompt,
  AtomAfterContext,
  AtomBeforeContext,
  AtomOfName,
  Card,
  EquipSlot,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
} from '../types';
import { runUseFlow, chargeOnSettle } from '../skills/cards/use-card';
import { registerAction, registerAfterHook, registerBeforeHook, hasBlockingPending } from '../core/skill';
import { isCancelled } from '../core/frame';
import { applyAtom } from '../core/apply';
import { DISTANCE_ATTACK_RANGE_KEY } from '../rules/vars-keys';

// ────────────────────────── 虚拟杀结算 ──────────────────────────

export interface RunVirtualSlashOptions {
  /** 虚拟杀 cardId 前缀(技能名):最终 id 为 `${prefix}:杀:${source}:${target}:${state.seq}` */
  prefix: string;
  /** 是否计入出杀次数(挂 chargeOnSettle 计费,由 杀.onSettle→incSlashUsed 累加)。默认不计。 */
  charge?: boolean;
}

/**
 * 执行一次"视为出杀"的完整结算(无实体牌,runUseFlow virtual 模式):
 * 指定目标→成为目标→检测有效性→询问闪→伤害/抵消,时机 atom 序列与实体杀一致。
 * 虚拟杀无实体,但结算流程中 atoms/toViewEvents 需要 cardMap[id] 存在,故先写入、结算后删除(不入弃牌堆)。
 * 不消耗手牌、无距离限制(调用方已选定目标,不再校验距离)。
 *
 * @returns 是否对 target 造成了伤害(结算前后体力差比对;防具/反馈/奸雄等可能改伤)。
 *          不关心该结果的调用方可直接忽略返回值。
 */
export async function runVirtualSlash(
  state: GameState,
  source: number,
  target: number,
  opts: RunVirtualSlashOptions,
): Promise<boolean> {
  if (!state.players[target]?.alive) return false;
  const targetHealthBefore = state.players[target].health;
  const cardId = `${opts.prefix}:杀:${source}:${target}:${state.seq}`;
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };
  await runUseFlow(state, source, cardId, [target], '杀', {
    virtual: true,
    onSettle: opts.charge ? chargeOnSettle(state, source, cardId) : undefined,
  });
  delete state.cardMap[cardId];
  return state.players[target].health < targetHealthBefore;
}

// ────────────────────────── respond validate 样板 ──────────────────────────

export interface RequireRequestTypeOptions {
  /** requestType 不在允许列表时的错误文案 */
  mismatchError: string;
  /** pending slot 缺失时的错误文案(默认 '当前不需要回应') */
  noSlotError?: string;
  /** slot 的 atom 类型不是 请求回应 时的错误文案(默认同 noSlotError) */
  wrongTypeError?: string;
}

export type RequestTypeCheck =
  | { error: string; requestType: null }
  | { error: null; requestType: string };

/**
 * respond validate 通用样板:读座次的 pending slot → 断言 atom 为 请求回应 → 比对 requestType。
 * 任一步不满足即返回对应错误文案;全部通过时返回匹配到的 requestType(供后续按类型分支校验参数)。
 *
 * 用法:
 * ```ts
 * const check = requireRequestType(state, ownerId, [CONFIRM_RT, ARRANGE_RT], {
 *   mismatchError: '当前不是恂恂询问',
 * });
 * if (check.error) return check.error;
 * const rt = check.requestType;
 * ```
 */
export function requireRequestType(
  state: GameState,
  seat: number,
  requestTypes: readonly string[],
  opts: RequireRequestTypeOptions,
): RequestTypeCheck {
  const atom = state.pendingSlots.get(seat)?.atom;
  const noSlotError = opts.noSlotError ?? '当前不需要回应';
  if (!atom) return { error: noSlotError, requestType: null };
  if (atom.type !== '请求回应') {
    return { error: opts.wrongTypeError ?? noSlotError, requestType: null };
  }
  if (!requestTypes.includes(atom.requestType)) {
    return { error: opts.mismatchError, requestType: null };
  }
  return { error: null, requestType: atom.requestType };
}

// ────────────────────────── confirm 型询问/respond 样板 ──────────────────────────

/** registerConfirmRespond 可选项。 */
export interface ConfirmRespondOptions {
  /** requestType 不匹配时的错误文案(默认 `当前不是${skillId}确认`) */
  mismatchError?: string;
}

/**
 * 注册 confirm 型 respond action(单一 confirm 询问的完整三件套):
 *   validate = requireRequestType(单 requestType);
 *   execute  = localVars[confirmedKey] = choice===true || confirmed===true
 * (choice/confirmed 是客户端两种键名形态,一并接受)。
 * 仅适用于「该 respond 只处理一个 confirm 询问」的形态;confirm 之外还分支
 * 选牌/选人/额外参数校验的 respond(反馈/寒冰剑/界利驭/界强识 模式)不适用,
 * 仍由各技能手写分支。返回 unloader(registerAction 原样透传)。
 */
export function registerConfirmRespond(
  state: GameState,
  skillId: string,
  ownerId: number,
  requestType: string,
  confirmedKey: string,
  opts: ConfirmRespondOptions = {},
): () => void {
  return registerAction(
    state,
    skillId,
    ownerId,
    'respond',
    (st, _params) =>
      requireRequestType(st, ownerId, [requestType], {
        mismatchError: opts.mismatchError ?? `当前不是${skillId}确认`,
      }).error,
    async (st, params) => {
      st.localVars[confirmedKey] = params.choice === true || params.confirmed === true;
    },
  );
}

/** askConfirm 可选项(title/文案/超时各技能现状不同,逐字透传,不得统一)。 */
export interface AskConfirmOptions {
  /** localVars 确认键:询问前 delete 清残值;回应后由 respond execute 写入。 */
  confirmedKey: string;
  /** prompt.title */
  title: string;
  /** prompt.description(可选) */
  description?: string;
  /** prompt.confirmLabel(可选) */
  confirmLabel?: string;
  /** prompt.cancelLabel(可选) */
  cancelLabel?: string;
  /** 超时默认选择。请求回应.onTimeout 仅对弃牌型询问写 localVars,confirm 型超时
   *  不写 → 确认键 undefined 时按本值兜底(undefined==default 模式,同 制霸/洛神)。 */
  defaultChoice?: boolean;
  /** 超时秒数(各技能不同:再起/反馈/寒冰剑/界利驭 10、克己/界强识 15、博图 20) */
  timeout?: number;
}

/**
 * confirm 型询问三段样板:delete 确认键残值 → applyAtom(请求回应,confirm prompt)
 * → 读确认键并归一为 boolean(超时未设键按 defaultChoice 兜底)。
 * 读后不删确认键:屯田 的「判定牌生效后」hook 在本函数返回后仍需读取;
 * 需要收尾清理的调用方(博图/界利驭/界强识)自行 delete。
 */
export async function askConfirm(
  state: GameState,
  requestType: string,
  target: number,
  opts: AskConfirmOptions,
): Promise<boolean> {
  delete state.localVars[opts.confirmedKey];
  await applyAtom(state, {
    type: '请求回应',
    requestType,
    target,
    prompt: {
      type: 'confirm',
      title: opts.title,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      ...(opts.confirmLabel !== undefined ? { confirmLabel: opts.confirmLabel } : {}),
      ...(opts.cancelLabel !== undefined ? { cancelLabel: opts.cancelLabel } : {}),
    },
    ...(opts.defaultChoice !== undefined ? { defaultChoice: opts.defaultChoice } : {}),
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
  });
  const answer = state.localVars[opts.confirmedKey];
  if (answer === undefined) return opts.defaultChoice === true;
  return answer === true;
}

// ────────────────────────── pending requestType 读取 ──────────────────────────

/** 当前 pending 的 requestType(类型安全读取)。座次无 pending 时返回 undefined。 */
export function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as { requestType?: string }).requestType;
}

// ────────────────────────── 装备牌栏位推断 ──────────────────────────

/** 装备牌 subtype → 装备栏位(与 装备 atom 的 inferSlot 一致) */
export function slotOf(card: { subtype?: string } | undefined): EquipSlot | null {
  switch (card?.subtype) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}

// ────────────────────────── 影子卡有效 id ──────────────────────────

/** 牌的有效 id:转化影子卡 → shadowOf 原卡 id(影子卡入弃牌堆时被引擎还原为原卡,
 *  须按原卡 id 才能在弃牌堆/装备区找到);真实牌即本体 id。 */
export function effectiveCardId(state: GameState, cardId: string): string {
  return state.cardMap[cardId]?.shadowOf ?? cardId;
}

// ────────────────────────── 出牌时机四合一 ──────────────────────────

/** 引擎侧「现在可以主动出牌/用技」四合一:自己回合 + 出牌阶段 + 无阻塞 pending + 存活。
 *  与 view 侧 rules/action-active.ts 的 defaultPlayActive 语义同源(那边不查存活,
 *  由按钮渲染层兜底);各转化技 validate 里逐字复制的五连判收敛于此。 */
export function engineCanPlayNow(state: GameState, ownerId: number): boolean {
  return (
    state.currentPlayerIndex === ownerId &&
    state.phase === '出牌' &&
    !hasBlockingPending(state) &&
    state.players[ownerId]?.alive === true
  );
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

/** 座次当前 pending 是否为「问本人出杀」(转化技 validate 的回应路径维度)。 */
function askedKillPendingFor(state: GameState, ownerId: number): boolean {
  const slot = state.pendingSlots.get(ownerId);
  return (
    !!slot && (slot.atom as { target?: number }).target === ownerId && isAskedKillSlot(slot)
  );
}

/** view 侧同源判定:当前视角是否被询问出杀(onMount activeWhen 的回应路径维度)。 */
export function viewAskedKill(ctx: ActionContext): boolean {
  const slot = ctx.view.pending;
  return (
    !!slot && slot.target === ctx.perspectiveIdx && isAskedKillSlot(slot)
  );
}

// ────────────────────────── 转化技统一注册(五件套工厂) ──────────────────────────
//
// 转化技(武圣族/丈八蛇矛/乱击族/双雄族…)的 preceding transform action 五件套:
// shadowIdOf 构造 / validate / execute / rollback / onMount defineAction。
// 此前 16 个文件逐字手写,四处平行实现漂移出真实 bug(界武圣影子后缀写成技能名、
// 界火计 rollback 漏还原武器距离 vars)。差异维度全部参数化:
//   牌来源(仅手牌 / 含装备区)、卡片谓词、产出牌名、多卡张数、时机维度。
//
// 两条 CLAUDE.md 不变量由工厂单点保证:
//   ① 影子卡 id 后缀 = 技能 id(客户端按 `${选中牌 id 以 # 连接}#${skillId}` 构造主
//      action 的 cardId)——shadowIdOf 一律以注册传入的 skillId 作后缀;
//   ② 转化方向/目标语义由产出牌自己的 use action 决定——工厂只产出 outputName 影子,
//      不声明任何目标语义。
//
// rollback 契约:dispatch 在跑 preceding 前快照全部玩家可见状态(hand/marks/vars/
// equipment/cardMap/localVars/turn),任一 reject 路径按快照整体还原(core/rollback.ts,
// 「被拒动作不得改变可见数组」)——故此处不手写 hand/marks 还原,只保留配对副作用:
// 删影子卡、装备槽位/距离 vars 还原(_origSlot/_unequipped 记录)、extraRollback。

/** 转化技时机维度:
 *  - 'play'              自己回合出牌阶段(默认;火计/奇袭/乱击族/双雄族/朱雀羽扇/界疠火…)
 *  - 'playOrRespondKill' 上述 + 被询问杀时打出(武圣/界武圣/丈八蛇矛/界父魂)
 *  - 'any'               不限时机,只查存活+持牌(倾国:被询问闪时打出) */
export type TransformContext = 'play' | 'playOrRespondKill' | 'any';

/** onMount defineAction 声明(mountTransformAction 消费;prompt/activeWhen 逐字保留) */
export interface TransformMountOptions {
  label: string;
  style?: 'primary' | 'danger' | 'default' | 'passive';
  prompt: ActionPrompt;
  /** 基础激活谓词(持牌/装备判断 + 出牌路径时机);回应路径(被询问杀)由调用方
   *  以 `|| viewAskedKill(ctx)` 叠加,与引擎 validate 的时机维度同源。 */
  activeWhen?: ActionActiveWhen;
  /** false = 不附带 transform 回调(急袭:选牌经 marks 特殊处理,非「当作」型)。默认附带。 */
  noTransform?: boolean;
}

export interface TransformActionOptions {
  /** 产出牌名:决定主 action 语义(客户端按产出牌自己的 use/respond action 派发) */
  outputName: string;
  /** 产出牌伤害属性(朱雀羽扇/界疠火 → '火焰')。缺省不设。 */
  outputDamageType?: '普通' | '火焰' | '雷电';
  /** 消耗牌张数(默认 1;丈八蛇矛/乱击族/界父魂主转化 = 2)。 */
  cardCount?: number;
  /** 牌来源含装备区:装备牌先「卸下」到手牌再「当作」,rollback 还原槽位与距离 vars
   *  (界武圣/界火计/奇袭/界父魂)。默认仅手牌。 */
  includeEquipment?: boolean;
  /** 时机维度,默认 'play'。 */
  context?: TransformContext;
  /** 业务谓词(颜色/花色/牌名/状态标记),在基础条件(时机/存活/持牌/牌存在)之外追加;
   *  不满足时与其他基础条件一样返回 invalidError。 */
  cardPredicate?: (state: GameState, ownerId: number, cardIds: string[]) => boolean;
  /** 基础条件不满足时的统一拒绝文案(完全自定义 validate 的技能不会走到默认路径,可省)。 */
  invalidError?: string;
  /** 多卡形状(数量)错误的拒绝文案(默认 `需要选择 N 张牌`)。 */
  needCardsError?: string;
  /** 注册 actionType(默认 'transform';界父魂 granted='武圣transform'、
   *  界渐营=`transform:<牌名>` 每个声明牌名一个 action)。 */
  actionType?: string;
  /** 选牌参数名(默认单卡 'cardId'/多卡 'cardIds';急袭='markId')。 */
  paramKey?: string;
  /** 完全替换默认 validate(急袭/界渐营:逐条件独立拒绝文案)。 */
  validate?: (
    state: GameState,
    ownerId: number,
    params: Record<string, Json>,
  ) => string | null;
  /** 「当作」前的配对步骤(界渐营限次标记:「首个 await 之前设 vars」契约由此保证)。 */
  beforeExecute?: (
    state: GameState,
    ownerId: number,
    cardIds: string[],
    params: Record<string, Json>,
  ) => Promise<void> | void;
  /** 「当作」后的配对步骤(界渐营花色继承/界疠火 localVars 标记)。 */
  afterExecute?: (
    state: GameState,
    ownerId: number,
    shadowId: string,
    cardIds: string[],
  ) => Promise<void> | void;
  /** 完全替换默认 execute(急袭:田不在手牌,不走「当作」,去标记后直接建影子入手)。 */
  execute?: (
    state: GameState,
    ownerId: number,
    params: Record<string, Json>,
    shadowId: string,
  ) => Promise<void>;
  /** rollback 追加配对还原(localVars/vars 清理;hand/marks 由 dispatch 快照兜底)。 */
  extraRollback?: (
    state: GameState,
    ownerId: number,
    cardIds: string[],
    shadowId: string,
  ) => void;
  /** onMount defineAction 声明(mountTransformAction 消费)。 */
  mount?: TransformMountOptions;
}

/** 从 params 读出选牌 id 列表(单卡 [cardId] / 多卡 cardIds / 自定义 paramKey)。 */
function readTransformCardIds(
  params: Record<string, Json>,
  count: number,
  paramKey?: string,
): string[] | undefined {
  if (count === 1) {
    const id = params[paramKey ?? 'cardId'];
    return typeof id === 'string' ? [id] : undefined;
  }
  const ids = params['cardIds'];
  return Array.isArray(ids) ? (ids as string[]) : undefined;
}

/** 装备槽还原 + 武器距离 vars 重建(卸下 atom 清除了 vars[DISTANCE_ATTACK_RANGE_KEY],
 *  该 var 仅由 装备 atom 设值不会重算;镜像 装备 atom 的设值逻辑)。 */
function refitEquipment(
  state: GameState,
  self: { equipment: Partial<Record<EquipSlot, string>>; vars: Record<string, Json> },
  slot: EquipSlot,
  cardId: string,
): void {
  self.equipment[slot] = cardId;
  if (slot === '武器') {
    const card = state.cardMap[cardId];
    self.vars[DISTANCE_ATTACK_RANGE_KEY] = card?.range ?? 1;
  }
}

/**
 * 注册一个转化技 preceding transform action(onInit 内调用),返回 unloader。
 *
 * 默认实现:
 * - validate:时机(context 维度)+ 存活 + 持牌(可选含装备区)+ 牌存在 + cardPredicate,
 *   统一拒绝文案 invalidError;多卡形状错误用 needCardsError/'cardIds 必须为字符串'/'不能选择同一张牌'。
 * - execute:(includeEquipment 时先「卸下」并记 _origSlot/_unequipped)→ beforeExecute →
 *   「当作」(outputName/outputDamageType)→ afterExecute。
 * - rollback:删影子卡 + 装备槽位/距离 vars 还原 + extraRollback;不还原 hand/marks
 *   (dispatch 快照整体还原,见 core/rollback.ts)。
 */
export function registerTransformAction(
  state: GameState,
  skillId: string,
  ownerId: number,
  opts: TransformActionOptions,
): () => void {
  const count = opts.cardCount ?? 1;
  /** 影子卡 id:单卡 `${cardId}#${skillId}`,多卡 `${id1}#…#${skillId}`。
   *  ⚠ 后缀必须是技能 id(客户端按同一约定构造主 action 的 cardId,见 CLAUDE.md)。 */
  const shadowIdOf = (cardIds: string[]): string => `${cardIds.join('#')}#${skillId}`;

  const defaultValidate = (st: GameState, params: Record<string, Json>): string | null => {
    const self = st.players[ownerId];
    let cardIds: string[] | undefined;
    if (count === 1) {
      const id = params[opts.paramKey ?? 'cardId'];
      if (typeof id === 'string') cardIds = [id];
    } else {
      const ids = params['cardIds'];
      if (!Array.isArray(ids) || ids.length !== count) {
        return opts.needCardsError ?? `需要选择 ${count} 张牌`;
      }
      if (!ids.every((x) => typeof x === 'string')) return 'cardIds 必须为字符串';
      if (new Set(ids).size !== count) return '不能选择同一张牌';
      cardIds = ids;
    }
    // 时机(倾国 'any' 不限)+ 存活 + 持牌(可选含装备区)+ 牌存在 + 业务谓词
    const contextOk =
      opts.context === 'any' ||
      engineCanPlayNow(st, ownerId) ||
      (opts.context === 'playOrRespondKill' && askedKillPendingFor(st, ownerId));
    const selfAlive = self?.alive === true;
    const cardInZone =
      !!cardIds &&
      !!self &&
      cardIds.every((id) =>
        self.hand.includes(id) ||
        (opts.includeEquipment === true &&
          Object.values(self.equipment).some((e) => e === id)),
      );
    const cardsExist = !!cardIds && cardIds.every((id) => !!st.cardMap[id]);
    const predicateOk =
      !cardIds || !opts.cardPredicate || opts.cardPredicate(st, ownerId, cardIds);
    const ok = contextOk && selfAlive && cardInZone && cardsExist && predicateOk;
    return ok ? null : (opts.invalidError ?? '转化条件不满足');
  };

  const validateAction = (st: GameState, params: Record<string, Json>): string | null =>
    opts.validate ? opts.validate(st, ownerId, params) : defaultValidate(st, params);

  const executeAction = async (st: GameState, params: Record<string, Json>): Promise<void> => {
    // 自定义 execute(急袭:田 → 影子,不走「当作」)
    if (opts.execute) {
      const id = params[opts.paramKey ?? 'cardId'];
      const cardIds = typeof id === 'string' ? [id] : [];
      await opts.execute(st, ownerId, params, shadowIdOf(cardIds));
      return;
    }
    const cardIds = readTransformCardIds(params, count, opts.paramKey);
    if (!cardIds) return;
    const self = st.players[ownerId];
    // 装备区牌:先「卸下」到手牌(产生 ViewEvent,清除装备 vars)再「当作」(当作要求牌在手牌)。
    // 单卡记 _origSlot / 多卡记 _unequipped,供 rollback 还原槽位。
    if (opts.includeEquipment && self) {
      if (count === 1) {
        const entry = Object.entries(self.equipment).find(([, id]) => id === cardIds[0]);
        if (entry) {
          const slot = entry[0] as EquipSlot;
          params['_origSlot'] = slot;
          await applyAtom(st, { type: '卸下', player: ownerId, slot });
        }
      } else {
        const equipsToUnequip = cardIds
          .map((cid) => {
            const entry = Object.entries(self.equipment).find(([, id]) => id === cid);
            return entry ? { slot: entry[0] as EquipSlot, cardId: cid } : null;
          })
          .filter((x): x is { slot: EquipSlot; cardId: string } => x !== null);
        if (equipsToUnequip.length > 0) {
          params['_unequipped'] = equipsToUnequip;
          for (const { slot } of equipsToUnequip) {
            await applyAtom(st, { type: '卸下', player: ownerId, slot });
          }
        }
      }
    }
    await opts.beforeExecute?.(st, ownerId, cardIds, params);
    // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
    const shadowId = shadowIdOf(cardIds);
    await applyAtom(st, {
      type: '当作',
      player: ownerId,
      cardIds,
      shadowId,
      outputName: opts.outputName,
      ...(opts.outputDamageType ? { outputDamageType: opts.outputDamageType } : {}),
    });
    await opts.afterExecute?.(st, ownerId, shadowId, cardIds);
  };

  const rollbackAction = (st: GameState, params: Record<string, Json>): void => {
    // hand/marks 由 dispatch 快照整体还原(core/rollback.ts),此处只撤销配对副作用。
    const cardIds = opts.execute
      ? readTransformCardIds(params, 1, opts.paramKey)
      : readTransformCardIds(params, count, opts.paramKey);
    if (!cardIds || cardIds.length === 0 || cardIds.some((id) => typeof id !== 'string')) {
      opts.extraRollback?.(st, ownerId, [], '');
      return;
    }
    const shadowId = shadowIdOf(cardIds);
    delete st.cardMap[shadowId];
    const self = st.players[ownerId];
    if (self) {
      // 单卡装备来源:还原装备槽位(含武器距离 vars)
      const origSlot = params['_origSlot'] as EquipSlot | undefined;
      if (origSlot) refitEquipment(st, self, origSlot, cardIds[0]);
      // 多卡装备来源:逐张还原;槽位已被其他流程占用时交由快照兜底
      const unequipped = params['_unequipped'] as
        | Array<{ slot: EquipSlot; cardId: string }>
        | undefined;
      for (const { slot, cardId } of unequipped ?? []) {
        if (self.equipment[slot] === undefined) refitEquipment(st, self, slot, cardId);
      }
    }
    opts.extraRollback?.(st, ownerId, cardIds, shadowId);
  };

  return registerAction(
    state,
    skillId,
    ownerId,
    opts.actionType ?? 'transform',
    validateAction,
    executeAction,
    rollbackAction,
  );
}

/**
 * onMount 侧配套:按同一份 opts 声明前端 defineAction(onMount 内调用)。
 * transform 回调由工厂统一构造({name: outputName, sourceCardId, fromSkill: skillId}),
 * 保证「产出牌名 + 技能 id 后缀」与引擎侧影子卡约定一致。
 */
export function mountTransformAction(
  api: FrontendAPI,
  skillId: string,
  opts: TransformActionOptions,
): void {
  const m = opts.mount;
  if (!m) return;
  api.defineAction(opts.actionType ?? 'transform', {
    label: m.label,
    style: m.style,
    prompt: m.prompt,
    ...(m.noTransform
      ? {}
      : {
          transform: (card: Card) => ({
            name: opts.outputName,
            sourceCardId: card.id,
            fromSkill: skillId,
          }),
        }),
    ...(m.activeWhen ? { activeWhen: m.activeWhen } : {}),
  });
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

// ────────────────────── 「自己使用的杀被闪抵消」after-hook ──────────────────────

/** registerOnOwnSlashDodged 可选项。 */
export interface OwnSlashDodgedOptions {
  /** 武器技限定:仅当 ownerId 武器栏装备该牌名时触发,并附带 isCancelled 复核
   *  (闪已被 drain 到弃牌堆,抵消态只能看结算帧 cancelled 标记)——
   *  与 贯石斧/青龙偃月刀 的武器分支逐字一致。武将技(界咆哮/界空城)不传。 */
  weaponName?: string;
}

/**
 * 注册「自己使用的【杀】被【闪】抵消」时机 hook('被抵消' atom 的 after hook;
 * 现存四处实现 贯石斧/青龙偃月刀/界咆哮/界空城 时机一致,均为 after,无需 before 变体)。
 *
 * 前导守卫(不满足则直接放行,不进入 handler):
 *   ① ctx.frame.skillId === '杀'——万箭齐发等锦囊被闪抵消不触发;
 *   ② atom.source === ownerId——只在"自己使用的杀"被抵消时触发;
 *   ③ opts.weaponName 时:owner 存活于 players + 武器栏有牌 + 卡名匹配 +
 *      isCancelled(state, atom.cardId, atom.target) 复核。
 *
 * 用法(武将技,界咆哮式摸牌):
 * ```ts
 * const unregHook = registerOnOwnSlashDodged(state, skill.id, ownerId, async (ctx) => {
 *   await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
 * });
 * ```
 *
 * 用法(武器技,须自备武器):
 * ```ts
 * const unregHook = registerOnOwnSlashDodged(state, skill.id, ownerId, handler, {
 *   weaponName: '贯石斧',
 * });
 * ```
 *
 * @returns unloader(registerAfterHook 原样透传)。
 */
export function registerOnOwnSlashDodged(
  state: GameState,
  skillId: string,
  ownerId: number,
  handler: (ctx: AtomAfterContext<AtomOfName<'被抵消'>>) => Promise<void>,
  opts: OwnSlashDodgedOptions = {},
): () => void {
  return registerAfterHook(state, skillId, ownerId, '被抵消', async (ctx) => {
    // 只对杀生效:万箭齐发等锦囊被闪抵消不触发
    if (ctx.frame.skillId !== '杀') return;
    // 只在"自己使用的杀"被抵消时触发
    if (ctx.atom.source !== ownerId) return;
    if (opts.weaponName !== undefined) {
      const self = ctx.state.players[ownerId];
      if (!self) return;
      const weaponId = self.equipment['武器'];
      if (!weaponId) return;
      if (ctx.state.cardMap[weaponId]?.name !== opts.weaponName) return;
      // 检查是否被抵消(闪已设置标记,但闪已被 drain 到弃牌堆)
      if (!isCancelled(ctx.state, ctx.atom.cardId, ctx.atom.target)) return;
    }
    await handler(ctx);
  });
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
}

/**
 * onMount 侧 confirm 型 defineAction 样板:
 * `api.defineAction(actionName, {label, style:'primary', prompt:{type:'confirm',
 * title, confirmLabel:'发动', cancelLabel:'不发动'}})`。
 * 约 150 处 confirm 型 onMount 逐字复制收敛于此;label/title 必填,
 * confirmLabel/cancelLabel/style/description/confirmDisabled 可覆盖默认。
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

// ────────────────────────── 「阶段开始」before-hook 前导守卫 ──────────────────────────

/** registerPhaseStartHook 可选项(可选附加守卫;更特化的条件留在 handler 内自查)。 */
export interface PhaseStartHookOptions {
  /** true = 追加 `state.currentPlayerIndex === ownerId` 守卫(阶段开始只对回合角色
   *  本人生效的技能,如神速三选项的 shensuPhaseEntry 同款检查)。默认不追加。 */
  requireCurrentPlayer?: boolean;
}

/**
 * 注册「阶段开始」before-hook 并内置前导三查:
 * atom.type === '阶段开始' + atom.player === ownerId + atom.phase === phase
 * (各技能 handler 开头逐字复制的三连),全部通过才进入 handler。
 * 额外语义守卫(存活/限一次标记/存在其他存活角色等)由 handler 自行实现,
 * 保持各技能现状语义可表达。
 *
 * 用法(神速选项1 骨架):
 * ```ts
 * const unreg = registerPhaseStartHook(
 *   state, skill.id, ownerId, '判定',
 *   async (ctx): Promise<HookResult | void> => {
 *     const self = ctx.state.players[ownerId];
 *     if (!self?.alive || self.vars[USED_KEY]) return;
 *     // …询问发动;发动则虚拟杀 + return { kind: 'cancel' }
 *   },
 *   { requireCurrentPlayer: true },
 * );
 * ```
 *
 * @returns unloader(registerBeforeHook 原样透传)。
 */
export function registerPhaseStartHook(
  state: GameState,
  skillId: string,
  ownerId: number,
  phase: string,
  handler: (ctx: AtomBeforeContext<AtomOfName<'阶段开始'>>) => Promise<HookResult | void>,
  opts: PhaseStartHookOptions = {},
): () => void {
  return registerBeforeHook(state, skillId, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== phase) return;
    if (opts.requireCurrentPlayer === true && ctx.state.currentPlayerIndex !== ownerId) return;
    return await handler(ctx);
  });
}
