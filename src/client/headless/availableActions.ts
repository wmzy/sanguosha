// src/client/headless/availableActions.ts
// 枚举当前座次可执行操作。纯函数，零副作用。
// 复用 gameViewHelpers 的 isActiveAction / findUseActionForCard / derivePlayRules / buildPlayParams。
import type {
  Card,
  GameView,
  ActionContext,
  ActionPrompt,
  ClientMessage as EngineClientMessage,
  Json,
  TargetFilter,
} from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import type { AvailableAction } from './types';
import {
  isActiveAction,
  findUseActionForCard,
  findAltActionsForCard,
  derivePlayRules,
  buildPlayParams,
  extractCardFilter,
  getTargetFilter,
  getSelfTarget,
  producedNameOf,
  resolveProducedAction,
  buildShadowCardId,
  comboSatisfied,
  resolveDistributeCardIds,
  ownMaterialCards,
  expandActionVariants,
  choosePlayerCandidates,
  selectTargetCandidates,
  promptTargetBounds,
  isTriggerablePromptType,
  distributeAllocateCandidates,
  effectiveTargetCard,
  isFreePlayWindow,
  type PlayRules,
} from '../utils/gameViewHelpers';
import {
  resolvePendingRespond,
  getPendingRequestType,
  requestTypeFirstSegment,
  getPendingRequestedName,
} from '../utils/pendingRespond';
import { viewSlashTargetMax } from '../../engine/rules/action-active';
import { resolveTargetSelection, validateTargetSelection } from '../../engine/rules/target-selection';

/** 计算 useCardAndTarget 的合法目标列表。
 *  默认排除自己；targetFilter.allowSelf=true（铁索连环含自己）时纳入自己。
 *  与 engine/card-effect/validate.ts isLegalTarget 语义对齐（allowSelf ⟷ kind='any'）。 */
function computeValidTargets(
  view: GameView,
  seatIndex: number,
  targetFilter: TargetFilter | null,
  rules: PlayRules,
): number[] {
  if (rules.selfTarget) return [seatIndex];
  if (!rules.needsTarget || !targetFilter) return [];
  const selection = resolveTargetSelection(view, seatIndex, targetFilter);
  return selection.targets ? selection.contract.candidates : [];
}

/** 目标数上下界(promptTargetBounds 的 AvailableAction 投影)。
 *  仅在「需要目标且非自动自身目标」时给值,且 >1 才输出字段(min/max 缺省 1 不设字段)。
 *  引擎 validate 用同一份 targetFilter 判定,AI 少了这个下界就只会填 1 个目标 →
 *  离间(两名男性角色)一类多目标技能恒拒。 */
function targetBoundsOf(
  prompt: ActionPrompt,
  rules: PlayRules,
): { minTarget?: number; maxTarget?: number } {
  if (!rules.needsTarget || rules.selfTarget) return {};
  const { min, max } = promptTargetBounds(prompt);
  return {
    ...(min > 1 ? { minTarget: min } : {}),
    ...(max > 1 ? { maxTarget: max } : {}),
  };
}

/** skip 兜底动作(广播无懈/不出/不发动等)的共享 message 字面量。 */
function skipMessage(ownerId: number): EngineClientMessage {
  return { skillId: '__skip', actionType: 'skip', ownerId, params: {}, baseSeq: 0 };
}

/** 杀类目标数上限(出牌/转化三处共用):仅【杀】且需目标时求 viewSlashTargetMax,
 *  其余牌 undefined。出牌路径传真实牌(火杀带 damageType,界疠火按之放宽);
 *  转化路径传 `{ name: 产出牌名 }`——转化杀非火杀,不传 damageType(界疠火仅对火杀生效)。 */
function slashTargetMaxOf(
  view: GameView,
  seatIndex: number,
  card: { name: string; damageType?: string },
  rules: PlayRules,
): number | undefined {
  return card.name === '杀' && rules.needsTarget && !rules.selfTarget
    ? viewSlashTargetMax(view, seatIndex, card)
    : undefined;
}

/** 出牌/替代出法共用的示例 params:无目标牌完整;有目标牌(非槽位)只给 cardId,
 *  targets 留给 agent 补全;构造失败(需目标未选等)回退 `{ cardId }`。
 *  此前 enumeratePlayActions 与 enumerateAltActions 各手写一份逐字重复的三元。 */
function samplePlayParams(
  view: GameView,
  seatIndex: number,
  card: Card,
  rules: PlayRules,
): Record<string, Json> {
  const built = buildPlayParams(view.players, seatIndex, card, rules, null, null);
  return rules.needsTarget && !rules.hasSlots && !rules.selfTarget
    ? { cardId: card.id }
    : (built ?? { cardId: card.id });
}

/** 出牌/替代出法共享的单卡 action 骨架(两枚举分支原为镜像手写):
 *  目标规则派生 → 合法目标计算 → 需要目标但无合法目标(如距离不够)跳过 → 示例 message。
 *  返回 null 表示该(牌,action)组合不可出。 */
function buildCardPlaySkeleton(
  view: GameView,
  seatIndex: number,
  action: SkillActionDef,
  card: Card,
): {
  message: EngineClientMessage;
  validTargets: number[];
  bounds: { minTarget?: number; maxTarget?: number };
  rules: PlayRules;
} | null {
  const targetFilter = getTargetFilter(action.prompt);
  const rules = derivePlayRules(targetFilter, getSelfTarget(action.prompt));
  // 算合法目标（allowSelf 时含自己）
  const validTargets = computeValidTargets(view, seatIndex, targetFilter, rules);
  // 需要目标但无合法目标(如距离不够),跳过此牌
  if (rules.needsTarget && !rules.selfTarget && validTargets.length === 0) return null;
  return {
    message: {
      skillId: action.skillId,
      actionType: action.actionType,
      ownerId: seatIndex,
      params: samplePlayParams(view, seatIndex, card, rules),
      baseSeq: 0,
    },
    validTargets,
    bounds: targetBoundsOf(action.prompt, rules),
    rules,
  };
}

/** 出牌阶段枚举主动可出的牌。 */
function enumeratePlayActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  const ctx: ActionContext = { view, perspectiveIdx: seatIndex };
  const me = view.players[seatIndex];
  if (!me?.hand) return [];
  const result: AvailableAction[] = [];
  for (const card of me.hand) {
    const action = findUseActionForCard(skillActions, card);
    if (!action) continue;
    if (!isActiveAction(action, ctx)) continue;
    const skeleton = buildCardPlaySkeleton(view, seatIndex, action, card);
    if (!skeleton) continue;
    const cardDesc = `${card.suit}${card.rank}`;
    // 杀受方天画戟(最后一张手牌)/天义/界疠火放宽目标数上限;其余牌默认 1。
    const slashMax = slashTargetMaxOf(view, seatIndex, card, skeleton.rules);
    result.push({
      description:
        skeleton.rules.needsTarget && !skeleton.rules.selfTarget
          ? slashMax && slashMax > 1
            ? `使用【${card.name}】(${cardDesc}) 选择目标(最多${slashMax}个)`
            : `使用【${card.name}】(${cardDesc}) 选择目标`
          : `使用【${card.name}】(${cardDesc})`,
      message: skeleton.message,
      validTargets: skeleton.validTargets,
      category: 'play',
      ...skeleton.bounds,
      ...(slashMax !== undefined ? { maxTarget: slashMax } : {}),
    });
  }
  return result;
}

/** 转化原料池:手牌;手牌匹配数不足以满足 minCards 时并入装备区(界父魂 两张牌、
 *  界武圣/奇袭 单张牌的引擎 validate 都接受装备区原料,手牌不足时旧实现只查手牌
 *  → 这类转化在无头/AI 客户端整类漏枚举)。
 *  纯手牌原料技(丈八蛇矛/标版武圣/乱击)不受影响:它们的 activeWhen 都已保证
 *  手牌匹配数 ≥ minCards(丈八 handCount≥2 / 武圣 手中有红牌 / 乱击 两张同花色),
 *  装备区不会被并入 → 不会为纯手牌技枚举出引擎必拒的组合。
 *  手牌匹配数已够时不并入装备区:前端无法从 cardFilter 区分「原料含装备区」
 *  (界父魂与丈八蛇矛的声明完全相同),只有手牌不足时才需要装备区兜底。 */
function transformMaterialPool(
  me: GameView['players'][number],
  view: GameView,
  filter: (c: Card) => boolean,
  minCards: number,
): Card[] {
  const hand = (me.hand ?? []).filter(filter);
  if (hand.length >= minCards) return hand;
  return ownMaterialCards(me, view, filter);
}

/** 转化·回应路径(被要求打出某牌):产出牌名由 transform 回调按首张原料求值,
 *  = pending 请求牌名时才可用;主 action = <产出牌名>.respond,无目标。
 *  多卡转化此前整段缺少回应路径 → 丈八蛇矛/界父魂 在南蛮入侵/决斗 的询问杀窗口里
 *  拿不到任何动作(浏览器 handleTransformPlay 有 respond 分支,只有无头/AI 客户端
 *  整类不可用)。 */
function buildTransformRespondAction(
  action: SkillActionDef,
  materials: Card[],
  seatIndex: number,
  requestedName: string,
): AvailableAction | null {
  const transform = action.transform;
  if (!transform) return null;
  const wrapperName = producedNameOf(transform, materials[0]);
  if (wrapperName !== requestedName) return null; // 产出牌名 = 请求牌名时可用
  const ids = materials.map((c) => c.id);
  // 影子卡 id 契约:`${选中牌 id 以 # 连接}#${skillId}`(与引擎 shadowIdOf 同约定)
  const shadowCardId = buildShadowCardId(ids, action.skillId);
  const desc = materials.map((c) => `${c.suit}${c.rank}`).join('+');
  return {
    description: `${action.skillId}转化【${wrapperName}】(${desc})打出`,
    message: {
      skillId: wrapperName,
      actionType: 'respond',
      ownerId: seatIndex,
      params: { cardId: shadowCardId },
      preceding: [
        {
          skillId: action.skillId,
          actionType: action.actionType,
          params: materials.length > 1 ? { cardIds: ids } : { cardId: ids[0] },
        },
      ],
      baseSeq: 0,
    },
    validTargets: [],
    category: 'transform',
  };
}

/** 转化·出牌路径(单卡/多卡两分支原手写的同管线合并):
 *  resolveProducedAction → computeValidTargets → 空目标跳过 → slashMax →
 *  selfTarget 预填 targets=[自己] → 影子 id → 构造主 action。
 *  - 产出牌名由 transform 回调**逐组合的首张原料**求值:丈八蛇矛 → 杀、乱击 → 万箭齐发;
 *    多向转化技(产出牌名随组合变化)不能只按 matchingCards[0] 取一次,硬编码 '杀'
 *    会让非杀产出的主 action 恒为 杀.use,引擎读影子卡名 validate 恒拒「不是杀」。
 *  - 产出牌门 + 目标语义(resolveProducedAction):产出牌无主动 use 入口(闪/无懈可击
 *    timing='生效前')或其 use action 未激活(桃 需已受伤)→ null 不枚举;目标语义取
 *    **产出牌自己的 use action**(酒无目标 / 桃 selfTarget / 杀 攻击范围),而非
 *    transform action 自身的 targetFilter(那是为出杀方向设计的)。
 *  - 转化杀同样受目标数上限约束(默认1;方天画戟看手牌数,天义拼点赢放宽到2)。
 *    转化杀非火杀,不传 damageType(界疠火仅对火杀生效)。 */
function buildTransformUseAction(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
  ctx: ActionContext,
  action: SkillActionDef,
  materials: Card[],
): AvailableAction | null {
  const gate = resolveProducedAction(skillActions, action, materials[0], ctx);
  if (!gate) return null;
  const { wrapperName, targetFilter: cardTargetFilter, rules: cardRules } = gate;
  // 算合法目标（allowSelf 时含自己，与 enumeratePlayActions 同模式）
  const validTargets = computeValidTargets(view, seatIndex, cardTargetFilter, cardRules);
  // 需要目标但无合法目标(如距离不够)→ 跳过该组合
  if (cardRules.needsTarget && !cardRules.selfTarget && validTargets.length === 0) return null;
  const ids = materials.map((c) => c.id);
  // 影子卡 id 契约:`${选中牌 id 以 # 连接}#${skillId}`(与引擎 shadowIdOf 同约定)
  const shadowCardId = buildShadowCardId(ids, action.skillId);
  const desc = materials.map((c) => `${c.suit}${c.rank}`).join('+');
  // 目标数边界与 promptTargetBounds 同源:产出牌 use action 的 prompt(无注册时
  // 回退 transform 自身 prompt),>1 才输出的投影格式见 targetBoundsOf。
  const bounds = targetBoundsOf((gate.produced ?? action).prompt, cardRules);
  const slashMax = slashTargetMaxOf(view, seatIndex, { name: wrapperName }, cardRules);
  // selfTarget 产出牌(桃/酒):与 buildPlayParams 同源预填 targets=[自己]
  const mainParams: EngineClientMessage['params'] = cardRules.selfTarget
    ? { cardId: shadowCardId, targets: [seatIndex] }
    : { cardId: shadowCardId };
  return {
    description:
      wrapperName === '杀' && slashMax && slashMax > 1
        ? `${action.skillId}转化【${wrapperName}】(${desc}) (最多${slashMax}目标)`
        : `${action.skillId}转化【${wrapperName}】(${desc})`,
    message: {
      skillId: wrapperName,
      actionType: 'use',
      ownerId: seatIndex,
      params: mainParams,
      preceding: [
        {
          skillId: action.skillId,
          actionType: action.actionType,
          params: materials.length > 1 ? { cardIds: ids } : { cardId: ids[0] },
        },
      ],
      baseSeq: 0,
    },
    validTargets,
    category: 'transform',
    ...bounds,
    ...(slashMax !== undefined ? { maxTarget: slashMax } : {}),
  };
}

/**
 * 枚举转化类技能动作(武圣/丈八蛇矛)。
 * transform action 的 prompt.type 是 useCardAndTarget,有 cardFilter + targetFilter。
 * 提交格式:主 action(杀.use) + preceding(transform)。
 * - 单卡转化(武圣,min=1):每张匹配牌一个 action,cardId 为影子 id `${原id}#skillId`。
 * - 多卡转化(丈八蛇矛,min>=2):组合数大,只生成描述性 action 提示 agent。
 * 单卡/多卡共用 buildTransformUseAction(出牌)/buildTransformRespondAction(回应)管线。
 */
function enumerateTransformActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  const ctx: ActionContext = { view, perspectiveIdx: seatIndex };
  const me = view.players[seatIndex];
  if (!me?.hand) return [];
  const result: AvailableAction[] = [];

  // 回应路径(被要求打出某牌):转化技"当该牌打出" → 主 action=<请求牌名>.respond(无目标)。
  // 请求牌名:询问X → X(询问杀/询问闪);请求回应 'R/...' → R(杀/respondKill、无懈可击…)。
  // 广播型(target<0,如无懈可击)对所有存活座次开放。
  // 此前只认 杀(询问杀 / 请求回应 杀/respondKill)→ 倾国(黑牌当闪)/龙胆(杀当闪)/
  // 看破(黑牌当无懈)在各自的回应窗口里拿不到任何动作,只能 skip。
  // 请求牌名解析与浏览器 usePlayInteraction 共享 getPendingRequestedName(原两处逐字重复)。
  // 非 null 即回应上下文(主 action 走 <请求牌名>.respond);null 为出牌路径(走 use)。
  const requestedName = getPendingRequestedName(view.pending ?? null, seatIndex);

  for (const action of skillActions) {
    // 转化能力由 `transform` 回调标记(与浏览器 PlayerCardLarge 同判据),而非 actionType:
    // 同一技能可有多个转化 action(界父魂 = 'transform' 两张牌 + '武圣transform' granted 单张牌),
    // 只认 'transform' 会让 granted 路径在无头/AI 客户端整类不可用。
    if (!action.transform) continue;
    if (!isActiveAction(action, ctx)) continue;
    const filter = extractCardFilter(action.prompt);
    if (!filter) continue;
    // cardFilter min/max 来自 prompt:useCardAndTarget(武圣/丈八蛇矛/龙胆)与
    // useCard(倾国/看破/酒池)两种 prompt 都带 cardFilter。
    // 此前只认 useCardAndTarget → useCard 型转化技(倾国当闪/看破当无懈)完全枚举不到。
    const cardFilter =
      action.prompt.type === 'useCardAndTarget' || action.prompt.type === 'useCard'
        ? action.prompt.cardFilter
        : null;
    if (!cardFilter) continue;
    const minCards = cardFilter.min ?? 1;
    // 原料池与单卡分支同源(手牌∪装备区,手牌不足时并入装备区)——界武圣/奇袭
    // 的装备区红/黑牌此前被整类漏枚举(引擎 validate 接受装备区原料)。
    const matchingCards = transformMaterialPool(me, view, filter, minCards);

    if (minCards > 1) {
      // 多卡转化(丈八蛇矛/乱击/界乱击):为每对匹配牌生成一个具体 action,
      // 主 action params.cardId = 影子 id(`${id1}#${id2}#skillId`),
      // preceding transform 携带 cardIds=[id1,id2];agent 仅需补 targets。
      // (回归 yrjQ7X:旧实现只生成 params={} 的描述性 action + 空 validTargets,
      //  agent 无法构造合法 preceding/影子 cardId → 丈八蛇矛完全不可用。)
      // 组合约束(乱击/界乱击:两张牌同花色)。单卡 filter 表达不了「两张牌之间」的约束,
      // 缺了它客户端会枚举出引擎必拒的组合 —— AI 的 pickBestAction 是确定性的,
      // 反复挑中同一非法组合就永久空转(扫描实测 378 个组合里大量被拒)。
      // 判据与浏览器 transformComboOk 共享 comboSatisfied(手牌∪装备区解析)。
      const comboFilter = cardFilter.comboFilter;
      const materialById = new Map(matchingCards.map((c) => [c.id, c]));
      const combosOk = (c1: Card, c2: Card): boolean =>
        comboSatisfied(comboFilter, (id) => materialById.get(id), [c1.id, c2.id]);

      for (let i = 0; i < matchingCards.length; i++) {
        for (let j = i + 1; j < matchingCards.length; j++) {
          const c1 = matchingCards[i];
          const c2 = matchingCards[j];
          if (!combosOk(c1, c2)) continue;
          const built =
            requestedName !== null
              ? buildTransformRespondAction(action, [c1, c2], seatIndex, requestedName)
              : buildTransformUseAction(view, seatIndex, skillActions, ctx, action, [c1, c2]);
          if (built) result.push(built);
        }
      }
      continue;
    }

    // 单卡转化(武圣/龙胆/界武圣/奇袭):每张匹配牌生成一个 action。
    for (const card of matchingCards) {
      const built =
        requestedName !== null
          ? buildTransformRespondAction(action, [card], seatIndex, requestedName)
          : buildTransformUseAction(view, seatIndex, skillActions, ctx, action, [card]);
      if (built) result.push(built);
    }
  }
  return result;
}

/**
 * 枚举分配类技能动作(制衡/仁德)。
 * 这些 action 的 actionType 是 'use',但 prompt.type 是 'distribute',
 * 被 findUseActionForCard 跳过(它只匹配 useCard/useCardAndTarget)。
 * - select 模式(制衡):选牌弃置换牌,无目标,params={cardIds:[]}。
 * - allocate 模式(仁德):分配手牌给目标,params={allocation:[]},validTargets 为可选目标。
 */
function enumerateDistributeActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  const ctx: ActionContext = { view, perspectiveIdx: seatIndex };
  const result: AvailableAction[] = [];

  for (const action of skillActions) {
    if (action.actionType !== 'use') continue;
    if (action.prompt.type !== 'distribute') continue;
    if (!isActiveAction(action, ctx)) continue;

    const prompt = action.prompt;
    const mode = prompt.mode ?? 'allocate';

    if (mode === 'select') {
      // select 模式(制衡):选牌弃置换牌,无目标
      const sourceDesc = prompt.source === 'handAndEquip' ? '手牌或装备' : '手牌';
      result.push({
        description: `发动【${action.skillId}】（选${sourceDesc}弃置换牌）`,
        message: {
          skillId: action.skillId,
          actionType: 'use',
          ownerId: seatIndex,
          params: { cardIds: [] },
          baseSeq: 0,
        },
        validTargets: [],
        category: 'distribute',
      });
    } else {
      // allocate 模式(仁德):分配手牌给目标
      // 候选判定与浏览器 isTargetable/distribute 点座位共享 distributeAllocateCandidates
      const validTargets = distributeAllocateCandidates(view, seatIndex, prompt);
      result.push({
        description: `发动【${action.skillId}】（分配手牌给目标）`,
        message: {
          skillId: action.skillId,
          actionType: 'use',
          ownerId: seatIndex,
          params: { allocation: [] },
          baseSeq: 0,
        },
        validTargets,
        category: 'distribute',
      });
    }
  }
  return result;
}

/** 枚举替代出牌动作（同一张牌的其他出法，如铁索连环·重铸、连环·重铸）。
 *  这些 action 不属于 use/respond/transform/distribute（各有独立入口），
 *  通过 findAltActionsForCard 匹配手牌，生成无目标的 play action（params={cardId}）。
 *  无头客户端此前缺这一类枚举 → AI 无法重铸铁索连环。 */
function enumerateAltActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  const ctx: ActionContext = { view, perspectiveIdx: seatIndex };
  const me = view.players[seatIndex];
  if (!me?.hand) return [];
  const result: AvailableAction[] = [];
  for (const card of me.hand) {
    const primary = findUseActionForCard(skillActions, card);
    const alts = findAltActionsForCard(skillActions, card, primary);
    for (const action of alts) {
      if (!isActiveAction(action, ctx)) continue;
      // 替代出法也要按自身 prompt 派生目标规则(与主出牌分支同源):
      // 义绝/界断粮 等 useCardAndTarget 型替代出法需要目标,旧实现固定
      // validTargets=[] 且 params 只有 cardId → AI 提交缺目标,引擎恒拒
      // 「需要选择目标」,整类替代出法在无头/AI 客户端不可用。
      const skeleton = buildCardPlaySkeleton(view, seatIndex, action, card);
      if (!skeleton) continue;
      const cardDesc = `${card.suit}${card.rank}`;
      result.push({
        description:
          skeleton.bounds.minTarget && skeleton.bounds.minTarget > 1
            ? `${action.label}(${cardDesc}) 选择目标(需 ${skeleton.bounds.minTarget} 个)`
            : `${action.label}(${cardDesc})`,
        message: skeleton.message,
        validTargets: skeleton.validTargets,
        category: 'play',
        ...skeleton.bounds,
      });
    }
  }
  return result;
}

/** 多选描述性 action(selectTarget/choosePlayer 目标数下界 >1 时):targets 留空
 *  由 agent 从 validTargets 中选 minTarget..maxTarget 个填入;minTarget 仅 min>1
 *  时给,maxTarget 恒给。enumeratePromptActions(主动技多目标变体展开)与
 *  appendRespondActions(choosePlayer 多选)两处镜像结构共用,字段形态不变。 */
function describeMultiSelectAction(
  base: {
    description: string;
    skillId: string;
    actionType: string;
    ownerId: number;
    category: AvailableAction['category'];
  },
  validTargets: number[],
  min: number,
  max: number,
  extraParams: Record<string, Json> = {},
): AvailableAction {
  return {
    description: base.description,
    message: {
      skillId: base.skillId,
      actionType: base.actionType,
      ownerId: base.ownerId,
      params: { targets: [], ...extraParams },
      baseSeq: 0,
    },
    validTargets,
    category: base.category,
    ...(min > 1 ? { minTarget: min } : {}),
    maxTarget: max,
  };
}

/**
 * 枚举 prompt 非 useCard/useCardAndTarget/distribute 的主动技 use action。
 *
 * 这些技能不需要选中手牌,而是「点按钮 → 直接提交 params」(与前端 handleSkillAction
 * 的 default/selectTarget/choosePlayer 分支同构):
 *   - confirm(苦肉/缔盟/据守/奇谋/成略/界国色/界焚城/界甘露/界酒诗/乱武 等):params={}
 *   - selectTarget(挑衅/强袭/反间/攻心/雄乱/界翦灭/界势斩/界解烦/界献州):params.target
 *     (+ targets 数组,反间/雄乱 读 targets);prompt.paramVariants 声明的额外参数
 *     (强袭代价 cost)按「变体 × 目标」展开,避免提交缺参被 validate 拒。
 *     targetFilter.min>1 的多目标技能改为描述性 action(validTargets + minTarget,
 *     agent 填 targets),paramVariants 同样按变体展开。
 *   - choosePlayer(激将/界激将):每个候选目标一个 action(params.target);
 *     prompt.min>1 时镜像 selectTarget 的描述性多选 action。
 *   - chooseOption(决堰):每个选项一个 action(params.option)
 *
 * 此前这四类 prompt 无任何枚举路径(只有 useCard/useCardAndTarget/distribute 三种),
 * 无头客户端/AI 永远看不到这些技能 → 整类主动技不可发动。
 */
function enumeratePromptActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  const ctx: ActionContext = { view, perspectiveIdx: seatIndex };
  const me = view.players[seatIndex];
  if (!me?.hand) return [];
  const result: AvailableAction[] = [];
  for (const action of skillActions) {
    if (action.actionType !== 'use') continue;
    const prompt = action.prompt;
    // 与浏览器技能按钮共享 isTriggerablePromptType 白名单(不带 opts:转化类/
    // distribute 在无头侧走各自的独立枚举器,不在此纳入)。
    if (!isTriggerablePromptType(prompt)) continue;
    if (!isActiveAction(action, ctx)) continue;
    const base = {
      skillId: action.skillId,
      actionType: 'use' as const,
      ownerId: seatIndex,
      baseSeq: 0,
    };

    if (prompt.type === 'confirm') {
      result.push({
        description: `发动【${action.label}】(${prompt.title})`,
        message: { ...base, params: {} },
        validTargets: [],
        category: 'play',
      });
      continue;
    }

    if (prompt.type === 'chooseOption') {
      for (const opt of prompt.options) {
        result.push({
          description: `发动【${action.label}】:${opt.label}`,
          message: { ...base, params: { option: opt.value } },
          validTargets: [],
          category: 'play',
        });
      }
      continue;
    }

    // selectTarget / choosePlayer:合法目标列表
    //   choosePlayer 优先用投影层下发的 candidates(filter 无法跨进程序列化);
    //   selectTarget 走 selectTargetCandidates(存活 + allowSelf + targetFilter.filter,
    //   与浏览器 isTargetable 同判据——此前无头只查存活+filter、漏 allowSelf,
    //   会枚举出引擎必拒的自目标动作)。
    let validTargets: number[];
    if (prompt.type === 'choosePlayer') {
      validTargets = choosePlayerCandidates(view, prompt);
    } else {
      validTargets = selectTargetCandidates(view, seatIndex, prompt);
    }
    if (validTargets.length === 0) continue;

    // paramVariants(强袭代价 等):每个变体一个 action;缺省单个无额外参数的变体。
    // 变体声明的代价牌(强袭·弃武器):按「每个候选牌 × 每个合法目标」展开并预填 cardId,
    // 否则 agent 提交缺 cardId 被引擎恒拒「弃武器需要 cardId」(浏览器侧同源:选中武器牌后提交)。
    // 变体列表 + 代价牌(手牌∪装备区)展开与浏览器共享 expandActionVariants。
    const variants = expandActionVariants(action, me, view);

    // 多目标技能(selectTarget.targetFilter.min>1 或 choosePlayer.min>1,如「两名男性角色」类):
    // 逐目标展开的 action 每个只带 1 个目标 → 引擎 validate 必拒「目标数不足」
    // (choosePlayer 同理:prompt.min>1 时单候选展开同样必拒)。
    // 改为描述性 action:validTargets 给全集,minTarget/maxTarget 给边界,
    // agent 据此选 minTarget..maxTarget 个;paramVariants 按变体(× 代价牌)各生成
    // 一个描述性 action(与 min=1 的变体展开形态一致),携带 cost/cardId。
    const { min: multiMin, max: declaredMax } = promptTargetBounds(prompt);
    if (multiMin > 1) {
      // max 缺省(或 ≤1 的无效声明)时镜像回填 min:语义为「恰好 min 个」
      const max = declaredMax > 1 ? declaredMax : multiMin;
      for (const variant of variants) {
        const suffix = variant.label ? `(${variant.label})` : '';
        const costCards: Array<Card | undefined> = variant.cardFilter ? variant.costCards : [undefined];
        if (variant.cardFilter && costCards.length === 0) continue; // 无代价牌 → 该变体不可用
        for (const costCard of costCards) {
          const cardSuffix = costCard ? `(${costCard.suit}${costCard.rank})` : '';
          result.push(describeMultiSelectAction(
            {
              description: `发动【${action.label}】${suffix}${cardSuffix}(选 ${multiMin}${max > multiMin ? `-${max}` : ''} 个目标)`,
              skillId: action.skillId,
              actionType: 'use',
              ownerId: seatIndex,
              category: 'play',
            },
            validTargets,
            multiMin,
            max,
            // targets 留空由 agent 从 validTargets 中选 minTarget..maxTarget 个填入
            { ...variant.params, ...(costCard ? { cardId: costCard.id } : {}) },
          ));
        }
      }
      continue;
    }

    for (const t of validTargets) {
      const targetName = view.players[t]?.name ?? `P${t}`;
      for (const variant of variants) {
        const suffix = variant.label ? `(${variant.label})` : '';
        const costCards: Array<Card | undefined> = variant.cardFilter ? variant.costCards : [undefined];
        if (variant.cardFilter && costCards.length === 0) continue; // 无代价牌 → 该变体不可用
        for (const costCard of costCards) {
          const cardSuffix = costCard ? `(${costCard.suit}${costCard.rank})` : '';
          result.push({
            description: `发动【${action.label}】${suffix}${cardSuffix} → ${targetName}`,
            message: {
              ...base,
              // target 与 targets 同时携带:selectTarget 型技能两种读法都有
              // (反间/雄乱 读 params.targets,挑衅/强袭/激将 读 params.target)。
              params: {
                target: t,
                targets: [t],
                ...variant.params,
                ...(costCard ? { cardId: costCard.id } : {}),
              },
            },
            validTargets: [t],
            category: 'play',
          });
        }
      }
    }
  }
  return result;
}

/** 主入口：枚举当前座次可执行的操作（出牌/转化/替代出牌/分配/技能按钮/结束出牌阶段）。 */
export function enumerateAvailableActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  if (!view) return [];
  const actions = [
    ...enumeratePlayActions(view, seatIndex, skillActions),
    ...enumerateTransformActions(view, seatIndex, skillActions),
    ...enumerateAltActions(view, seatIndex, skillActions),
    ...enumerateDistributeActions(view, seatIndex, skillActions),
    ...enumeratePromptActions(view, seatIndex, skillActions),
  ];
  // 出牌阶段:当前玩家可主动结束回合(无阻塞 pending 时)——与 GameView 结束回合按钮
  // (canShowEndTurnButton)同一判据 isFreePlayWindow。
  if (
    isFreePlayWindow({
      isMyTurn: view.currentPlayerIndex === seatIndex,
      phase: view.phase,
      pending: view.pending,
    })
  ) {
    actions.push({
      description: '结束出牌阶段',
      message: {
        skillId: '回合管理',
        actionType: 'end',
        ownerId: seatIndex,
        params: {},
        baseSeq: 0,
      },
      validTargets: [],
      category: 'play',
    });
  }
  return actions.flatMap((action) => {
    const message = action.message;
    const definition = skillActions.find((entry) =>
      entry.skillId === message.skillId && entry.actionType === message.actionType) ??
      (message.actionType === 'use' ? skillActions.find((entry) =>
        entry.skillId === message.preceding?.[0]?.skillId && entry.actionType === message.preceding?.[0]?.actionType) : undefined);
    const prompt = definition?.prompt;
    if (!prompt || (prompt.type !== 'useCardAndTarget' && prompt.type !== 'selectTarget' && prompt.type !== 'choosePlayer'))
      return [action];
    if (prompt.type === 'useCardAndTarget' && prompt.selfTarget) return [action];
    const filter: TargetFilter = prompt.type === 'choosePlayer'
      ? { min: prompt.min, max: prompt.max, allowSelf: true, candidates: prompt.candidates, filter: prompt.filter }
      : prompt.targetFilter;
    if (!filter.slots?.length && filter.max === 0) return [action];
    const id = message.params.cardId;
    const material = message.preceding?.[0]?.params;
    const materialId = material?.cardId ?? (Array.isArray(material?.cardIds) ? material.cardIds[0] : undefined);
    const source = typeof id === 'string' ? view.cardMap[id] : undefined;
    const ingredient = typeof materialId === 'string' ? view.cardMap[materialId] : undefined;
    // 「选中牌是否按杀的动态目标上限解释」与浏览器 isTargetable 共享 effectiveTargetCard:
    // 选中牌 = 主 action 的牌(source)∪ 转化原料(ingredient)。usedCardName 声明
    // 「选中牌就是正在使用的牌」:有 preceding → 产出牌名 = 主 action 技能名(武圣
    // 红牌当杀,原牌名不足为凭);无 preceding 且 牌名 === skillId → 普通出牌
    // (杀本体);其余(离间 一类技能代价牌,哪怕代价牌恰好是杀)→ null,不按杀
    // 解释,否则 min=max=2 塌成 1 被引擎拒。
    const usedCardName = message.preceding?.length
      ? message.skillId
      : source?.name === message.skillId
        ? source.name
        : null;
    const card = effectiveTargetCard(
      source ?? ingredient,
      filter,
      usedCardName,
    );
    const resolved = resolveTargetSelection(view, seatIndex, filter, card);
    if (!resolved.targets) return [];
    const current = Array.isArray(message.params.targets) ? message.params.targets as number[] : [];
    const targets = validateTargetSelection(view, seatIndex, filter, current, card)
      ? current : resolved.targets;
    const params = { ...message.params, targets };
    if ('target' in params) params.target = targets[0];
    return [{
      ...action,
      message: { ...message, params },
      validTargets: resolved.contract.candidates,
      targetSelection: resolved.contract,
      ...(resolved.contract.min !== 1 ? { minTarget: resolved.contract.min } : {}),
      maxTarget: resolved.contract.max,
    }];
  });
}

// ─── pending 驱动的回应动作枚举(自 HeadlessGameClient 迁入) ───

/** 枚举 pending 驱动的回应/弃牌/选牌/选将动作,追加到 out(HeadlessGameClient.getAvailableActions
 *  在 enumerateAvailableActions 之后调用)。纯函数:只依赖 view + skillActions + actionSeat,
 *  不依赖客户端实例传输状态。策略:
 *  - 选将询问:每个候选武将一个 selectChar action;
 *  - 广播型 pending(无懈可击):补一个 skip;
 *  - pickTargetCard/pickProcessingCard:每张可选牌一个 respond;
 *  - 弃牌(__弃牌/强制弃牌):预填「前 N 张」的默认 cardIds;
 *  - choosePlayer/chooseOption/distribute/useCardAndTarget/confirm:按 prompt 类型展开;
 *  - cardFilter 型(出闪/出杀/求桃):每张匹配手牌一个 respond + skip 兜底。 */
export function appendRespondActions(
  view: GameView,
  skillActions: SkillActionDef[],
  out: AvailableAction[],
  actionSeat: number,
): void {
  const ownerId = actionSeat;
    const pending = view.pending!;
    // 卡牌回应 silent 模式(target 有手牌但无匹配牌):target 不被询问。
    // 不为该 pending 生成任何 skip/respond action,让短延时 slot 自然超时
    // (否则 AI 会提前 skip 绕过延时,暴露"无匹配牌"信息)。广播型(target<0)永不为 silent。
    if (pending.responseMode === 'silent' && pending.target === ownerId) return;
    const atom = pending.atom as {
      type: string;
      candidates?: Array<{ name: string; skills: string[]; baseId?: string }>;
      requestType?: string;
    };
    // 选将询问：每个候选武将一个 selectChar action（引擎注册 系统规则:选将）
    if (atom.type === '选将询问' && Array.isArray(atom.candidates)) {
      for (const c of atom.candidates) {
        out.push({
          description: `选择武将【${c.name}】`,
          message: {
            skillId: '系统规则',
            actionType: '选将',
            ownerId,
            params: { character: c.name },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'selectChar',
        });
      }
      return;
    }
    // 广播型 pending（无懈可击等）：添加跳过 action
    if (pending.target < 0) {
      out.push({
        description: '跳过（不打出无懈可击）',
        message: skipMessage(ownerId),
        validTargets: [],
        category: 'skip',
      });
    }
    const reqType = getPendingRequestType(pending);
    // pickTargetCard 类型 prompt（过河拆桥/顺手牵羊/反馈 选牌）：生成可选牌动作。
    // skillId 按 requestType 的首段（'过河拆桥_选牌'→'过河拆桥'、'反馈/选牌'→'反馈'）
    // 与前端 resolvePendingRespond 一致；动作文案按 obtain/discard 区分。
    if (pending.prompt?.type === 'pickTargetCard') {
      const pickPrompt = pending.prompt;
      const targetIdx = pickPrompt.target;
      const targetPlayer = view.players[targetIdx];
      // requestType 形如 '过河拆桥_选牌' / '顺手牵羊_选牌' / '反馈/选牌'
      const pickSkillId = requestTypeFirstSegment(reqType);
      // obtain=获得（顺手牵羊/反馈）；discard=弃置（过河拆桥）
      const obtain = reqType.startsWith('顺手牵羊') || reqType.startsWith('反馈');
      const verb = obtain ? '获得' : '弃置';
      // 装备牌（明牌）：每张一个 action
      for (const eq of (pickPrompt.equipment ?? [])) {
        out.push({
          description: `${verb}【${eq.cardName}】(装备)`,
          message: {
            skillId: pickSkillId,
            actionType: 'respond',
            ownerId,
            params: { zone: 'equipment', cardId: eq.cardId },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'respond',
        });
      }
      // 判定区牌（明牌）
      for (const j of (pickPrompt.judge ?? [])) {
        out.push({
          description: `${verb}【${j.cardName}】(判定区)`,
          message: {
            skillId: pickSkillId,
            actionType: 'respond',
            ownerId,
            params: { zone: 'judge', cardId: j.cardId },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'respond',
        });
      }
      // 手牌（盲选：按位置选）
      const handCount = pickPrompt.handCount ?? targetPlayer?.handCount ?? 0;
      if (handCount > 0) {
        out.push({
          description: `${verb}手牌（第1张）`,
          message: {
            skillId: pickSkillId,
            actionType: 'respond',
            ownerId,
            params: { zone: 'hand', handIndex: 0 },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'respond',
        });
      }
      return;
    }
    // pickProcessingCard 类型 prompt（五谷丰登：从处理区亮的明牌选一张）：
    // 为每张可选牌生成独立 respond action，与前端 AwaitingPrompt 一致。
    if (pending.prompt?.type === 'pickProcessingCard') {
      const pickPrompt = pending.prompt;
      const pickSkillId = requestTypeFirstSegment(reqType);
      for (const c of (pickPrompt.cards ?? [])) {
        out.push({
          description: `选【${c.cardName} ${c.suit}${c.rank}】`,
          message: {
            skillId: pickSkillId,
            actionType: 'respond',
            ownerId,
            params: { cardId: c.cardId },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'respond',
        });
      }
      return;
    }
    // 弃牌阶段：引擎注册 系统规则:respond，validate 要求 params.cardIds。
    // 预填「前 N 张」作为可执行默认值，agent 可直接提交；需要优化时再改 cardIds。
    if (reqType === '__弃牌') {
      const minCount = pending.prompt?.type === 'useCard' ? pending.prompt.cardFilter.min : 1;
      const me = view.players[ownerId];
      const discardIds = (me?.hand ?? []).slice(0, Math.max(minCount, 1)).map((c) => c.id);
      out.push({
        description: `弃牌（默认选前 ${discardIds.length} 张，可改 cardIds）`,
        message: {
          skillId: '系统规则',
          actionType: 'respond',
          ownerId,
          params: { cardIds: discardIds },
          baseSeq: 0,
        },
        validTargets: [],
        category: 'discard',
      });
      return;
    }
    // 强制型弃牌(英魂等):mandatory=true + useCard prompt。与 __弃牌 同构,
    // 但 skillId 由 resolvePendingRespond 推导(英魂/discard → '英魂'),不硬编码 系统规则。
    // 不生成 skip(弃牌是义务)。agent 须从手牌选足 min 张填入 cardIds。
    if (pending.mandatory === true && pending.prompt?.type === 'useCard') {
      const minfo = resolvePendingRespond(pending, skillActions);
      const minCount = pending.prompt.cardFilter.min;
      const me = view.players[ownerId];
      const candidates = pending.prompt.cardFilter.candidates;
      const baseIds = candidates ? [...candidates] : (me?.hand ?? []).map((c) => c.id);
      const discardIds = baseIds.slice(0, Math.max(minCount, 1));
      out.push({
        description: `强制弃牌（默认选前 ${discardIds.length} 张，可改 cardIds）`,
        message: {
          skillId: minfo?.skillId ?? '系统规则',
          actionType: 'respond',
          ownerId,
          params: { cardIds: discardIds },
          baseSeq: 0,
        },
        validTargets: [],
        category: 'discard',
      });
      return;
    }
    // 通用回应（出闪/出杀/确认发动等）
    const info = resolvePendingRespond(pending, skillActions);
    if (info?.skillId) {
      // choosePlayer 类（突袭/激将/奋威 等）：用引擎注入的可序列化 candidates
      // （filter 跨进程序列化丢失，不能依赖）。单选逐候选生成独立 action；
      // 多选生成一个描述性 action，agent 需填 targets。
      if (pending.prompt?.type === 'choosePlayer') {
        const choosePrompt = pending.prompt;
        const validTargets: number[] = choosePlayerCandidates(view, choosePrompt);
        const max = choosePrompt.max ?? 1;
        const min = choosePrompt.min ?? 1;
        if (max <= 1) {
          // 单选：每个候选一个独立 action（与其他 respond 一致，agent 直接选）
          for (const t of validTargets) {
            out.push({
              description: `${choosePrompt.title ?? info.skillId} → ${view.players[t]?.name ?? `P${t}`}`,
              message: {
                skillId: info.skillId,
                actionType: 'respond',
                ownerId,
                params: { target: t, targets: [t] },
                baseSeq: 0,
              },
              validTargets: [t],
              category: 'respond',
            });
          }
          if (min === 0) {
            out.push({
              description: `${choosePrompt.title ?? info.skillId} → 不选择`,
              message: {
                skillId: info.skillId,
                actionType: 'respond',
                ownerId,
                params: { targets: [] },
                baseSeq: 0,
              },
              validTargets: [],
              category: 'skip',
            });
          }
        } else {
          // 多选：描述性 action，agent 需从 validTargets 填 targets。
          // minTarget/maxTarget 与描述文本同源(prompt.min/max):结构化字段让
          // agent 不必解析描述文本即可知道要选几个。
          out.push(describeMultiSelectAction(
            {
              description: `${choosePrompt.title ?? info.skillId}（选 ${min}-${max} 个目标）`,
              skillId: info.skillId,
              actionType: 'respond',
              ownerId,
              category: 'respond',
            },
            validTargets,
            min,
            max,
          ));
        }
        return;
      }
      // chooseOption 类（化身:选技能/选化身牌/选行动等）：每个选项一个 action。
      if (pending.prompt?.type === 'chooseOption') {
        const p = pending.prompt;
        for (const opt of p.options) {
          out.push({
            description: opt.label,
            message: {
              skillId: info.skillId,
              actionType: 'respond',
              ownerId,
              params: { option: opt.value },
              baseSeq: 0,
            },
            validTargets: [],
            category: 'respond',
          });
        }
        return;
      }
      // 被动 distribute prompt（贯石斧杀被闪抵消后选 2 张弃置强命 / 遗计分配 等
      // 请求回应型 distribute）。与主动 distribute（制衡/仁德 use，由 enumerateDistributeActions
      // 处理）不同：这里 actionType='respond'，skillId 由 resolvePendingRespond 推导
      // （贯石斧/select → '贯石斧'）。
      // Bug4:此前无此分支，落入下方 info.cardFilter 兜底——deriveCardFilterFromAtom 对
      // distribute 误推 c.name===skillId 匹配 0 张手牌 → 只生成 skip → AI 永远不发动贯石斧。
      if (pending.prompt?.type === 'distribute') {
        const distPrompt = pending.prompt;
        const mode = distPrompt.mode ?? 'allocate';
        const me = view.players[ownerId];
        const equip = (me?.equipment ?? {}) as Partial<Record<string, string>>;
        if (mode === 'select') {
          const requestType = (pending.atom as { requestType?: string }).requestType;
          if (requestType === '观星/arrange') {
            // 观星的 distribute 契约不是 cardIds，而是 { top, bottom }。默认「全留顶、
            // 保持原顺序」：top[0]=最先摸到=牌堆顶，因此 top 是 observed 的逆序；
            // 这样整理牌堆后顺序不变，是无需 LLM 补参的可执行动作。
            const observed = distPrompt.cardIds ?? [];
            out.push({
              description: `发动【${info.skillId}】（观星：全部留在牌堆顶，保持原顺序）`,
              message: {
                skillId: info.skillId,
                actionType: 'respond',
                ownerId,
                params: { top: [...observed].reverse(), bottom: [] },
                baseSeq: 0,
              },
              validTargets: [],
              category: 'distribute',
            });
          } else {
          // select 模式（贯石斧/神速②/制衡式弃牌 等）：选 minTotal..maxTotal 张。
          // 候选可凑足下限时才生成 distribute（否则只 skip）；params.cardIds 留空由
          // agent/LLM 补全——与主动 distribute（enumerateDistributeActions 制衡）一致，
          // 避免对不同技能（神速②需装备、观星需排列）预填出非法 cardIds。
          const candidateIds = resolveDistributeCardIds(distPrompt, me?.hand ?? [], equip);
          const minTotal = distPrompt.minTotal ?? 1;
          if (candidateIds.length >= minTotal) {
            out.push({
              description: `发动【${info.skillId}】（选 ${minTotal} 张${
                distPrompt.source === 'handAndEquip' ? '手牌或装备' : '手牌'
              }弃置）`,
              message: {
                skillId: info.skillId,
                actionType: 'respond',
                ownerId,
                // 预填可执行的下限选择，避免 agent 原样提交空 cardIds 被拒。
                params: { cardIds: candidateIds.slice(0, Math.max(minTotal, 1)) },
                baseSeq: 0,
              },
              validTargets: [],
              category: 'distribute',
            });
          }
          }
        } else {
          // allocate 模式（遗计/界遗计 分配 等）：params.allocation 由 agent 补全。
          out.push({
            description: `发动【${info.skillId}】（分配牌给目标，需填 allocation）`,
            message: {
              skillId: info.skillId,
              actionType: 'respond',
              ownerId,
              params: { allocation: [] },
              baseSeq: 0,
            },
            validTargets: [],
            category: 'distribute',
          });
        }
        // 可选询问（非 mandatory）：提供 skip（贯石斧 defaultChoice=false → 不发动）
        if (pending.target >= 0 && pending.mandatory !== true) {
          out.push({
            description: `不发动【${info.skillId}】`,
            message: skipMessage(ownerId),
            validTargets: [],
            category: 'skip',
          });
        }
        return;
      }
      // confirm 类（突袭/trigger 等）优先于 cardFilter：
      //   询问杀/闪 的 prompt 也是 confirm，但它们需要 cardId（atom.type 以「询问」开头）。
      //   只有 请求回应 + confirm 才是纯确认操作（choice: true/false）。
      const atomType = atom.type ?? '';
      const isAskType = atomType.startsWith('询问');
      // useCardAndTarget 类回应（界天香选牌+选目标 / 乱武·挑衅·借刀杀人 逼杀）：
      // 既有 cardFilter 又有 targetFilter，agent 须同时提交 cardId + target。
      // 此前落入下方通用 cardFilter 分支只带 cardId、无目标信息 → 永远被拒（界天香卡死）。
      if (!isAskType && pending.prompt?.type === 'useCardAndTarget') {
        const prompt = pending.prompt;
        const me = view.players[ownerId];
        // 可选牌:优先用投影层下发的 candidates(权威,跨进程),否则用 info.cardFilter 过滤手牌
        const candidateIds = prompt.cardFilter.candidates;
        let candidates: Card[];
        if (candidateIds) {
          // candidates 是权威候选(可能含装备区等非手牌来源,如界天香弃红桃装备)。
          // 按 id 从 cardMap 取 Card,不限定于 me.hand —— 否则装备区候选被滤掉,
          // AI 永远无法选装备弃牌(界天香只持红桃装备时触发后卡死/超时)。
          candidates = candidateIds
            .map((id) => view.cardMap[id])
            .filter((c): c is Card => !!c);
        } else if (info.cardFilter) {
          candidates = me?.hand?.filter((c) => info.cardFilter!(c)) ?? [];
        } else {
          candidates = me?.hand ?? [];
        }
        for (const card of candidates) {
          const resolved = resolveTargetSelection(view, ownerId, prompt.targetFilter, card);
          const targetParams: Record<string, Json> = resolved.targets
            ? { targets: resolved.targets }
            : {};
          if (prompt.targetFilter.min > 0 && !resolved.targets) continue;
          out.push({
            description: `回应【${info.skillId}】(${card.suit}${card.rank})`,
            message: {
              skillId: info.skillId,
              actionType: 'respond',
              ownerId,
              params: { cardId: card.id, ...targetParams },
              baseSeq: 0,
            },
            validTargets: resolved.contract.candidates,
            targetSelection: resolved.contract,
            category: 'respond',
            ...(resolved.contract.min > 1 ? { minTarget: resolved.contract.min } : {}),
            maxTarget: resolved.contract.max,
          });
        }
        if (pending.target >= 0) {
          out.push({
            description: candidates.length === 0 ? `无牌可出，跳过` : `不出【${info.skillId}】`,
            message: skipMessage(ownerId),
            validTargets: [],
            category: 'skip',
          });
        }
        return;
      }
      if (!isAskType && pending.prompt?.type === 'confirm') {
        const confirmLabel = pending.prompt.confirmLabel ?? '确认';
        const cancelLabel = pending.prompt.cancelLabel ?? '取消';
        // confirmDisabled(如界狂骨满血):不生成 confirm(choice=true) action,AI 只能选 cancel
        if (pending.prompt.confirmDisabled !== true) {
          out.push({
            description: `${confirmLabel}【${info.skillId}】`,
            message: {
              skillId: info.skillId,
              actionType: 'respond',
              ownerId,
              params: { choice: true },
              baseSeq: 0,
            },
            validTargets: [],
            category: 'respond',
          });
        }
        out.push({
          description: `${cancelLabel}`,
          message: {
            skillId: info.skillId,
            actionType: 'respond',
            ownerId,
            params: { choice: false },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'skip',
        });
      } else if (info.cardFilter) {
        // 需要选牌（杀/闪等）：为每张可出的牌生成独立 respond action（带 cardId）
        // 求桃救援（rescueSkillForCard）：桃/酒/急救红牌各自走对应技能 respond
        const me = view.players[ownerId];
        const candidates = me?.hand?.filter((c) => info.cardFilter!(c)) ?? [];
        for (const card of candidates) {
          const rescueSkill = info.rescueSkillForCard?.(card);
          out.push({
            description: `回应【${rescueSkill ?? info.skillId}】(${card.suit}${card.rank})`,
            message: {
              skillId: rescueSkill ?? info.skillId,
              actionType: 'respond',
              ownerId,
              params: { cardId: card.id },
              baseSeq: 0,
            },
            validTargets: [],
            category: 'respond',
          });
        }
        // 没有可出的牌或策略性不出：提供 skip
        // 广播型 pending（target<0）已在上面添加过 skip，不重复
        if (pending.target >= 0) {
          out.push({
            description: candidates.length === 0 ? `无牌可出，跳过` : `不出【${info.skillId}】`,
            message: skipMessage(ownerId),
            validTargets: [],
            category: 'skip',
          });
        }
      } else {
        // 兜底（choosePlayer 等）：空 params，agent 需自行补全 targets
        out.push({
          description: `回应【${info.skillId}】`,
          message: {
            skillId: info.skillId,
            actionType: 'respond',
            ownerId,
            params: {},
            baseSeq: 0,
          },
          validTargets: [],
          category: 'respond',
        });
      }
}
}
