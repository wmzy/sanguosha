// src/engine/util/skillRuntime/transform.ts — 转化技五件套工厂 + 影子卡 id 构造/还原。
// (自 util/skillRuntime.ts 按内聚拆出;导出经桶文件 skillRuntime.ts re-export,调用方零改动。)
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
import type {
  ActionActiveWhen,
  ActionPrompt,
  Card,
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
} from '../../types';
import { registerAction } from '../../core/skill';
import { applyAtom } from '../../core/apply';
import { DISTANCE_ATTACK_RANGE_KEY } from '../../rules/vars-keys';
import { engineCanPlayNow, isAskedKillSlot } from './misc';

// ────────────────────────── 影子卡 id ──────────────────────────

/** 影子卡 id 构造:`${牌id}#${技能id}`(多卡:牌 id 以 # 连接后再接技能 id)。
 *  ⚠ 后缀必须是技能 id——客户端按同一约定构造主 action 的 cardId,写成技能名会让
 *  主 action 读不到 cardMap[影子id] → validate 恒失败(见 CLAUDE.md)。 */
export function shadowCardId(cardId: string, skillId: string): string {
  return `${cardId}#${skillId}`;
}

/** 牌的有效 id:转化影子卡 → shadowOf 原卡 id(影子卡入弃牌堆时被引擎还原为原卡,
 *  须按原卡 id 才能在弃牌堆/装备区找到);真实牌即本体 id。 */
export function effectiveCardId(state: GameState, cardId: string): string {
  return state.cardMap[cardId]?.shadowOf ?? cardId;
}

/** 座次当前 pending 是否为「问本人出杀」(工厂 'playOrRespondKill' 时机维度的引擎侧判定)。 */
function askedKillPendingFor(state: GameState, ownerId: number): boolean {
  const slot = state.pendingSlots.get(ownerId);
  return (
    !!slot && (slot.atom as { target?: number }).target === ownerId && isAskedKillSlot(slot)
  );
}

// ────────────────────────── 转化技统一注册(五件套工厂) ──────────────────────────

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
  /** 产出牌名:决定主 action 语义(客户端按产出牌自己的 use/respond action 派发)。
   *  多向转化技(龙胆 杀↔闪)改用 outputNameOf 按原卡名定向,此处为缺省占位。 */
  outputName: string;
  /** 多向转化的动态产出牌名(按消耗牌名推导,如 龙胆/界龙胆):返回 undefined 视为
   *  不成立(execute 静默返回,validate 已拦截)。缺省用固定 outputName。 */
  outputNameOf?: (sourceCardName: string) => string | undefined;
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
  /** 追加校验:在默认路径的 时机/存活/持牌/牌存在/cardPredicate 全部通过后调用,
   *  返回拒绝文案或 null(多向转化技 龙胆/界龙胆 只保留方向(to)校验,不重写前置检查;
   *  与 validate 互斥使用——validate 完全替换默认路径,不会再走 extraValidate)。 */
  extraValidate?: (
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
 *   统一拒绝文案 invalidError;多卡形状错误用 needCardsError/'cardIds 必须为字符串'/'不能选择同一张牌';
 *   全部通过后追加 extraValidate(多向转化技的方向校验)。
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
  const shadowIdOf = (cardIds: string[]): string => shadowCardId(cardIds.join('#'), skillId);

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
    if (!ok) return opts.invalidError ?? '转化条件不满足';
    return opts.extraValidate?.(st, ownerId, params) ?? null;
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
    // 多向转化(龙胆/界龙胆)按消耗牌名定向;返回 undefined = validate 已拦截,防御性返回
    const outputName = opts.outputNameOf
      ? opts.outputNameOf(st.cardMap[cardIds[0]]?.name ?? '')
      : opts.outputName;
    if (!outputName) return;
    // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
    const shadowId = shadowIdOf(cardIds);
    await applyAtom(st, {
      type: '当作',
      player: ownerId,
      cardIds,
      shadowId,
      outputName,
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
            // 多向转化按选牌定向(龙胆 杀→闪/闪→杀);cardPredicate 已保证可选牌可映射,
            // 此处兜底固定 outputName
            name: opts.outputNameOf?.(card.name) ?? opts.outputName,
            sourceCardId: card.id,
            fromSkill: skillId,
          }),
        }),
    ...(m.activeWhen ? { activeWhen: m.activeWhen } : {}),
  });
}
