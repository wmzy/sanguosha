// src/client/headless/availableActions.ts
// 枚举当前座次可执行操作。纯函数，零副作用。
// 复用 gameViewHelpers 的 isActiveAction / findUseActionForCard / derivePlayRules /
// buildPlayParams / buildTransformSubmitMessage(转化提交装配)/ usedCardNameOfMessage,
// 以及 utils/skipMessage 的 buildSkipMessage(skip 兜底动作)。
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
  buildTransformSubmitMessage,
  comboSatisfied,
  resolveDistributeCardIds,
  ownMaterialCards,
  expandActionVariants,
  choosePlayerCandidates,
  selectTargetCandidates,
  promptTargetBounds,
  choosePlayerAsTargetFilter,
  singleTargetParams,
  isTriggerablePromptType,
  distributeAllocateCandidates,
  effectiveTargetCard,
  usedCardNameOfMessage,
  isFreePlayWindow,
  type PlayRules,
} from '../utils/gameViewHelpers';
import { buildSkipMessage } from '../utils/skipMessage';
import {
  resolvePendingRespond,
  getPendingRequestType,
  requestTypeFirstSegment,
  getPendingRequestedName,
  respondCandidates,
  rescueSkillFor,
  pickTargetCardEntries,
} from '../utils/pendingRespond';
import { viewSlashTargetMax } from '../../engine/rules/action-active';
import {
  resolveTargetSelection,
  validateTargetSelection,
  type TargetSelection,
} from '../../engine/rules/target-selection';

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

/** minTarget/maxTarget 的 AvailableAction 投影(全文件单一口径;原 targetBoundsOf /
 *  finalizeTargetContract / describeMultiSelectAction / respond 分支四处手写、
 *  比较器漂移过:min>1 vs min!==1、max>1 抑制 vs 恒输出):
 *  - min 用 `!== 1`:min=0 是「可选目标」语义(如 choosePlayer min=0 允许不选),
 *    必须投影 minTarget:0,否则 AI/agent 不知道 0 个也合法;min=1 与缺省同义,不设字段;
 *  - max 恒输出:消费方契约「未设时默认 1」(headless/types.ts 的 AvailableAction
 *    文档),显式 maxTarget:1 与省略语义等价;且 finalize 路径此前恒输出并被测试
 *    锁定(availableActions.test「默认杀 maxTarget=1」),改抑制口径反而破坏契约。
 *    ai-mcp/heuristics 的 withDefaultTargets 只读 minTarget(min<1 短路),不受影响。 */
type TargetProjection = { minTarget?: number; maxTarget: number };

function targetProjectionOf({ min, max }: { min: number; max: number }): TargetProjection {
  return {
    ...(min !== 1 ? { minTarget: min } : {}),
    maxTarget: max,
  };
}

/** 目标数上下界(promptTargetBounds 的 AvailableAction 投影)。
 *  仅在「需要目标且非自动自身目标」时给值;min/max 字段的取舍口径见 targetProjectionOf。
 *  引擎 validate 用同一份 targetFilter 判定,AI 少了这个下界就只会填 1 个目标 →
 *  离间(两名男性角色)一类多目标技能恒拒。 */
function targetBoundsOf(
  prompt: ActionPrompt,
  rules: PlayRules,
): { minTarget?: number; maxTarget?: number } {
  if (!rules.needsTarget || rules.selfTarget) return {};
  return targetProjectionOf(promptTargetBounds(prompt));
}

/** skip 兜底动作(广播无懈/不出/不发动等)的共享 message 构造在 utils/skipMessage.ts
 *  (与 HeadlessGameClient.pass、浏览器回应/自动跳过同一处)。 */

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

/** 目标型 action 的收尾(原 enumerateAvailableActions 尾部 flatMap 的单一实现,
 *  现下沉到各产出点就地调用一次,不再事后重算/覆盖上游 validTargets):
 *  - card-aware resolveTargetSelection:必选目标不可满足/槽位无解 → null,上游跳过;
 *  - 消息已带的 targets 合法则保留,否则回填最小合法组合(AvailableAction 的
 *    「最小合法消息可直接提交」契约);
 *  - targetSelection 契约 + minTarget/maxTarget 投影(杀的动态目标上限经 card 生效)。
 *  @param card    目标约束的 use 牌(代价牌/非使用牌传 undefined,见 effectiveTargetCard)
 *  @param current 消息里已携带的 targets */
function finalizeTargetContract(
  view: GameView,
  seatIndex: number,
  filter: TargetFilter,
  card: Card | undefined,
  current: number[],
): {
  targets: number[];
  targetSelection: TargetSelection;
  /** minTarget/maxTarget 投影(口径唯一来源 targetProjectionOf,消费方直接展开) */
  projection: TargetProjection;
} | null {
  const resolved = resolveTargetSelection(view, seatIndex, filter, card);
  if (!resolved.targets) return null;
  const targets = validateTargetSelection(view, seatIndex, filter, current, card)
    ? current
    : resolved.targets;
  return {
    targets,
    targetSelection: resolved.contract,
    projection: targetProjectionOf(resolved.contract),
  };
}

/** 出牌/替代出法共享的单卡 action 骨架(两枚举分支原为镜像手写):
 *  目标规则派生 → 合法目标计算 → 需要目标但无合法目标(如距离不够)跳过 → 目标收尾
 *  (预填最小合法 targets + targetSelection 契约)→ 示例 message。
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
  /** 展开进 AvailableAction 的目标投影(targetSelection 契约 + 收尾后的
   *  minTarget/maxTarget,置于 bounds/slashMax 之后即为最终权威值)。 */
  targetProjection: Partial<Pick<AvailableAction, 'targetSelection' | 'minTarget' | 'maxTarget'>>;
} | null {
  const targetFilter = getTargetFilter(action.prompt);
  const rules = derivePlayRules(targetFilter, getSelfTarget(action.prompt));
  // 算合法目标（allowSelf 时含自己）
  const validTargets = computeValidTargets(view, seatIndex, targetFilter, rules);
  // 需要目标但无合法目标(如距离不够),跳过此牌
  if (rules.needsTarget && !rules.selfTarget && validTargets.length === 0) return null;
  const message: EngineClientMessage = {
    skillId: action.skillId,
    actionType: action.actionType,
    ownerId: seatIndex,
    params: samplePlayParams(view, seatIndex, card, rules),
    baseSeq: 0,
  };
  const targetProjection: Partial<Pick<AvailableAction, 'targetSelection' | 'minTarget' | 'maxTarget'>> = {};
  // 目标收尾(原尾部 flatMap 下沉,算一次):需要目标的 useCardAndTarget/selectTarget
  // 型动作。use 牌约束:主出牌的 skillId===牌名 → 选中牌即使用牌(杀本体,动态上限
  // 生效);替代出法(义绝/断粮,skillId≠牌名)的选中牌是代价牌 → undefined。
  if (rules.needsTarget && targetFilter) {
    const fin = finalizeTargetContract(
      view,
      seatIndex,
      targetFilter,
      effectiveTargetCard(card, targetFilter, usedCardNameOfMessage(message, card)),
      [],
    );
    if (!fin) return null;
    message.params = { ...message.params, targets: fin.targets };
    targetProjection.targetSelection = fin.targetSelection;
    Object.assign(targetProjection, fin.projection);
  }
  return {
    message,
    validTargets,
    bounds: targetBoundsOf(action.prompt, rules),
    rules,
    targetProjection,
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
      ...skeleton.targetProjection,
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
  const desc = materials.map((c) => `${c.suit}${c.rank}`).join('+');
  return {
    description: `${action.skillId}转化【${wrapperName}】(${desc})打出`,
    // 消息装配(影子 id/preceding/selfTarget)与浏览器 handleTransformPlay 共享
    // buildTransformSubmitMessage
    message: buildTransformSubmitMessage({
      wrapperName,
      actionType: 'respond',
      ownerId: seatIndex,
      skillId: action.skillId,
      transformActionType: action.actionType,
      materialIds: ids,
    }),
    validTargets: [],
    category: 'transform',
  };
}

/** 转化·出牌路径(单卡/多卡两分支原手写的同管线合并):
 *  resolveProducedAction → computeValidTargets → 空目标跳过 → slashMax →
 *  构造主 action(selfTarget 预填 targets=[自己],影子 id/preceding 装配共享
 *  buildTransformSubmitMessage)。
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
  const desc = materials.map((c) => `${c.suit}${c.rank}`).join('+');
  // 消息装配(影子 id/preceding/selfTarget 预填 targets=[自己])与浏览器
  // handleTransformPlay 共享 buildTransformSubmitMessage;targets 留给 agent
  // 从 validTargets 补全,不传 targetIdx。
  const message = buildTransformSubmitMessage({
    wrapperName,
    actionType: 'use',
    ownerId: seatIndex,
    skillId: action.skillId,
    transformActionType: action.actionType,
    materialIds: ids,
    selfTarget: cardRules.selfTarget,
  });
  // 目标数边界与 promptTargetBounds 同源:产出牌 use action 的 prompt(无注册时
  // 回退 transform 自身 prompt),字段取舍口径见 targetProjectionOf。
  const bounds = targetBoundsOf((gate.produced ?? action).prompt, cardRules);
  const slashMax = slashTargetMaxOf(view, seatIndex, { name: wrapperName }, cardRules);
  // 目标收尾(原尾部 flatMap 下沉,算一次):产出牌需目标时,use 牌约束 =
  // 「首张原料牌 + 产出牌名」(影子 id 不在 cardMap,以原料代位——与浏览器
  // targetConstraintCard 的转化分支同源),预填最小合法 targets + 契约。
  let targetProjection: Partial<Pick<AvailableAction, 'targetSelection' | 'minTarget' | 'maxTarget'>> = {};
  if (cardRules.needsTarget && cardTargetFilter) {
    const fin = finalizeTargetContract(
      view,
      seatIndex,
      cardTargetFilter,
      effectiveTargetCard(materials[0], cardTargetFilter, usedCardNameOfMessage(message, undefined)),
      [],
    );
    if (!fin) return null;
    message.params = { ...message.params, targets: fin.targets };
    targetProjection = { targetSelection: fin.targetSelection, ...fin.projection };
  }
  return {
    description:
      wrapperName === '杀' && slashMax && slashMax > 1
        ? `${action.skillId}转化【${wrapperName}】(${desc}) (最多${slashMax}目标)`
        : `${action.skillId}转化【${wrapperName}】(${desc})`,
    message,
    validTargets,
    category: 'transform',
    ...bounds,
    ...(slashMax !== undefined ? { maxTarget: slashMax } : {}),
    ...targetProjection,
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
        ...skeleton.targetProjection,
      });
    }
  }
  return result;
}

/** 多选描述性 action(selectTarget/choosePlayer 目标数下界 >1 时):targets 留空
 *  由 agent 从 validTargets 中选 minTarget..maxTarget 个填入;min/max 字段取舍
 *  口径统一走 targetProjectionOf(min=0 投影 0)。enumeratePromptActions(主动技
 *  多目标变体展开)与 appendRespondActions(choosePlayer 多选)两处镜像结构共用,
 *  字段形态不变。 */
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
    ...targetProjectionOf({ min, max }),
  };
}

/** 变体 × 代价牌展开(enumeratePromptActions 的多目标描述性/逐目标两分支共用,
 *  原两处逐字重复):无 cardFilter 的变体按单个 undefined 代价展开;声明 cardFilter
 *  但无匹配代价牌(强袭·弃武器 手上无武器)则整组跳过(该变体不可用)。 */
function forEachVariantCostCard(
  variants: ReturnType<typeof expandActionVariants>,
  fn: (variant: ReturnType<typeof expandActionVariants>[number], costCard: Card | undefined) => void,
): void {
  for (const variant of variants) {
    const costCards: Array<Card | undefined> = variant.cardFilter ? variant.costCards : [undefined];
    if (variant.cardFilter && costCards.length === 0) continue; // 无代价牌 → 该变体不可用
    for (const costCard of costCards) fn(variant, costCard);
  }
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

    // 目标收尾(原尾部 flatMap 下沉,算一次):choosePlayer → TargetFilter 的形状
    // 映射共享 choosePlayerAsTargetFilter(此前为尾部 flatMap 手写);selectTarget/
    // choosePlayer 的变体代价牌不作 use 牌解释(card=undefined,不套 杀 的动态上限)。
    // 退化声明(无 slots 且 max===0)不收尾,与 needsTarget 判据一致。
    const targetFilter = prompt.type === 'choosePlayer'
      ? choosePlayerAsTargetFilter(prompt)
      : prompt.targetFilter;
    const fin = (targetFilter.slots?.length || targetFilter.max > 0)
      ? finalizeTargetContract(view, seatIndex, targetFilter, undefined, [])
      : null;
    if ((targetFilter.slots?.length || targetFilter.max > 0) && !fin) continue;

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
      forEachVariantCostCard(variants, (variant, costCard) => {
        const suffix = variant.label ? `(${variant.label})` : '';
        const cardSuffix = costCard ? `(${costCard.suit}${costCard.rank})` : '';
        result.push({
          ...describeMultiSelectAction(
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
            // targets 由收尾回填最小合法组合(可提交的默认值),agent 可改
            { ...variant.params, ...(costCard ? { cardId: costCard.id } : {}), ...(fin ? { targets: fin.targets } : {}) },
          ),
          ...(fin ? { targetSelection: fin.targetSelection, ...fin.projection } : {}),
        });
      });
      continue;
    }

    for (const t of validTargets) {
      const targetName = view.players[t]?.name ?? `P${t}`;
      forEachVariantCostCard(variants, (variant, costCard) => {
        const suffix = variant.label ? `(${variant.label})` : '';
        const cardSuffix = costCard ? `(${costCard.suit}${costCard.rank})` : '';
        result.push({
          description: `发动【${action.label}】${suffix}${cardSuffix} → ${targetName}`,
          message: {
            ...base,
            // target/targets 双形状同时携带(反间/雄乱 读 targets,挑衅/强袭/激将 读
            // target)——契约见 singleTargetParams。
            params: singleTargetParams(t, {
              ...variant.params,
              ...(costCard ? { cardId: costCard.id } : {}),
            }),
          },
          validTargets: [t],
          category: 'play',
          // 契约投影(收尾已算:[t] 经上游候选筛选恒合法,targets 无需逐目标重算)
          ...(fin ? { targetSelection: fin.targetSelection, ...fin.projection } : {}),
        });
      });
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
  // 注:useCardAndTarget/selectTarget/choosePlayer 的目标收尾(重算目标 + 预填
  // targets + targetSelection 契约)已在各产出点(出牌骨架/转化 use/prompt 枚举)
  // 就地完成——此前这里是统一 flatMap 事后重算并覆盖上游 validTargets,双算易漂移。
  return actions;
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
  /** respond 消息骨架(本函数 ~17 处 actionType:'respond' 字面量收敛):
   *  ownerId 即本枚举视角,baseSeq 占位 0(发送层覆写真实序号)。 */
  const respondMsg = (skillId: string, params: Record<string, Json>): EngineClientMessage => ({
    skillId,
    actionType: 'respond',
    ownerId,
    params,
    baseSeq: 0,
  });
  /** 弃牌类动作的共享构造(__弃牌 与 强制弃牌 两分支同构):预填「前 minCount 张」
   *  作为可执行默认值,agent 可直接提交;需要优化时再改 cardIds。skillId:
   *  __弃牌 恒 系统规则;强制弃牌由 resolvePendingRespond 推导(英魂 等)。 */
  const pushDiscardAction = (skillId: string, baseIds: string[], minCount: number, label: string): void => {
    const discardIds = baseIds.slice(0, Math.max(minCount, 1));
    out.push({
      description: `${label}（默认选前 ${discardIds.length} 张，可改 cardIds）`,
      message: respondMsg(skillId, { cardIds: discardIds }),
      validTargets: [],
      category: 'discard',
    });
  };
  if (!view.pending) return;
  const pending = view.pending;
  // 卡牌回应 silent 模式(target 有手牌但无匹配牌):target 不被询问。
  // 不为该 pending 生成任何 skip/respond action,让短延时 slot 自然超时
  // (否则 AI 会提前 skip 绕过延时,暴露"无匹配牌"信息)。广播型(target<0)永不为 silent。
  if (pending.responseMode === 'silent' && pending.target === ownerId) return;
  /** skip 兜底(useCardAndTarget 与 cardFilter 两分支逐字同构):单播型
   *  (target>=0)才补 skip——广播型(target<0)已在上方统一补过,不重复;
   *  无可出牌时文案切「无牌可出,跳过」,策略性不出为「不出【技能】」。 */
  const pushOptionalSkip = (skillId: string, hasCandidates: boolean): void => {
    if (pending.target >= 0) {
      out.push({
        description: hasCandidates ? `不出【${skillId}】` : `无牌可出，跳过`,
        message: buildSkipMessage(ownerId),
        validTargets: [],
        category: 'skip',
      });
    }
  };
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
      message: buildSkipMessage(ownerId),
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
    const targetPlayer = view.players[pickPrompt.target];
    // requestType 形如 '过河拆桥_选牌' / '顺手牵羊_选牌' / '反馈/选牌'
    const pickSkillId = requestTypeFirstSegment(reqType);
    // obtain=获得（顺手牵羊/反馈）；discard=弃置（过河拆桥）
    const obtain = reqType.startsWith('顺手牵羊') || reqType.startsWith('反馈');
    const verb = obtain ? '获得' : '弃置';
    // 可选项与 respond params 由 pickTargetCardEntries 统一构造(与浏览器面板同源);
    // prompt.handCount 缺失时以目标玩家手牌数兜底(盲选契约见该 helper 注释)。
    const describeEntry = (entry: {
      zone: 'equipment' | 'judge' | 'hand';
      cardName?: string;
      handIndex?: number;
    }): string => {
      switch (entry.zone) {
        case 'equipment':
          return `${verb}【${entry.cardName}】(装备)`;
        case 'judge':
          return `${verb}【${entry.cardName}】(判定区)`;
        default:
          return `${verb}手牌（第${(entry.handIndex ?? 0) + 1}张）`;
      }
    };
    for (const entry of pickTargetCardEntries(pickPrompt, targetPlayer?.handCount ?? 0)) {
      out.push({
        description: describeEntry(entry),
        message: respondMsg(pickSkillId, entry.params),
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
        message: respondMsg(pickSkillId, { cardId: c.cardId }),
        validTargets: [],
        category: 'respond',
      });
    }
    return;
  }
  // 弃牌阶段：引擎注册 系统规则:respond，validate 要求 params.cardIds。
  if (reqType === '__弃牌') {
    const minCount = pending.prompt?.type === 'useCard' ? pending.prompt.cardFilter.min : 1;
    const me = view.players[ownerId];
    pushDiscardAction('系统规则', (me?.hand ?? []).map((c) => c.id), minCount, '弃牌');
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
    pushDiscardAction(minfo?.skillId ?? '系统规则', baseIds, minCount, '强制弃牌');
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
            message: respondMsg(info.skillId, singleTargetParams(t)),
            validTargets: [t],
            category: 'respond',
          });
        }
        if (min === 0) {
          out.push({
            description: `${choosePrompt.title ?? info.skillId} → 不选择`,
            message: respondMsg(info.skillId, { targets: [] }),
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
          message: respondMsg(info.skillId, { option: opt.value }),
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
        const requestType = getPendingRequestType(pending);
        if (requestType === '观星/arrange') {
          // 观星的 distribute 契约不是 cardIds，而是 { top, bottom }。默认「全留顶、
          // 保持原顺序」：top[0]=最先摸到=牌堆顶，因此 top 是 observed 的逆序；
          // 这样整理牌堆后顺序不变，是无需 LLM 补参的可执行动作。
          const observed = distPrompt.cardIds ?? [];
          out.push({
            description: `发动【${info.skillId}】（观星：全部留在牌堆顶，保持原顺序）`,
            message: respondMsg(info.skillId, { top: [...observed].reverse(), bottom: [] }),
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
            // 预填可执行的下限选择，避免 agent 原样提交空 cardIds 被拒。
            message: respondMsg(info.skillId, { cardIds: candidateIds.slice(0, Math.max(minTotal, 1)) }),
            validTargets: [],
            category: 'distribute',
          });
        }
        }
      } else {
        // allocate 模式（遗计/界遗计 分配 等）：params.allocation 由 agent 补全。
        out.push({
          description: `发动【${info.skillId}】（分配牌给目标，需填 allocation）`,
          message: respondMsg(info.skillId, { allocation: [] }),
          validTargets: [],
          category: 'distribute',
        });
      }
      // 可选询问（非 mandatory）：提供 skip（贯石斧 defaultChoice=false → 不发动）
      if (pending.target >= 0 && pending.mandatory !== true) {
        out.push({
          description: `不发动【${info.skillId}】`,
          message: buildSkipMessage(ownerId),
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
      // 候选口径与浏览器共用 respondCandidates:投影层 candidates(权威,可能含
      // 装备区牌,如界天香弃红桃装备)优先;否则 info.cardFilter 过滤手牌。
      const candidates = respondCandidates(info, me?.hand ?? [], view.cardMap);
      for (const card of candidates) {
        const resolved = resolveTargetSelection(view, ownerId, prompt.targetFilter, card);
        const targetParams: Record<string, Json> = resolved.targets
          ? { targets: resolved.targets }
          : {};
        if (prompt.targetFilter.min > 0 && !resolved.targets) continue;
        out.push({
          description: `回应【${info.skillId}】(${card.suit}${card.rank})`,
          message: respondMsg(info.skillId, { cardId: card.id, ...targetParams }),
          validTargets: resolved.contract.candidates,
          targetSelection: resolved.contract,
          category: 'respond',
          ...targetProjectionOf(resolved.contract),
        });
      }
      pushOptionalSkip(info.skillId, candidates.length > 0);
      return;
    }
    if (!isAskType && pending.prompt?.type === 'confirm') {
      const confirmLabel = pending.prompt.confirmLabel ?? '确认';
      const cancelLabel = pending.prompt.cancelLabel ?? '取消';
      // confirmDisabled(如界狂骨满血):不生成 confirm(choice=true) action,AI 只能选 cancel
      if (pending.prompt.confirmDisabled !== true) {
        out.push({
          description: `${confirmLabel}【${info.skillId}】`,
          message: respondMsg(info.skillId, { choice: true }),
          validTargets: [],
          category: 'respond',
        });
      }
      out.push({
        description: `${cancelLabel}`,
        message: respondMsg(info.skillId, { choice: false }),
        validTargets: [],
        category: 'skip',
      });
    } else if (info.cardFilter) {
      // 需要选牌（杀/闪等）：为每张可出的牌生成独立 respond action（带 cardId）
      // 求桃救援（rescueSkillFor）：桃/酒/急救红牌各自走对应技能 respond
      const me = view.players[ownerId];
      // 候选口径与浏览器/useCardAndTarget 分支共用 respondCandidates:
      // candidates(权威)存在时含装备区牌(界鬼才换判定牌的手牌+装备候选),
      // 否则 info.cardFilter 过滤手牌(求桃:字面桃/酒 ∪ 急救等转化救援并集)。
      const candidates = respondCandidates(info, me?.hand ?? [], view.cardMap);
      for (const card of candidates) {
        const rescueSkill = rescueSkillFor(info, card);
        out.push({
          description: `回应【${rescueSkill}】(${card.suit}${card.rank})`,
          message: respondMsg(rescueSkill, { cardId: card.id }),
          validTargets: [],
          category: 'respond',
        });
      }
      // 没有可出的牌或策略性不出：提供 skip
      pushOptionalSkip(info.skillId, candidates.length > 0);
    } else {
      // 兜底（choosePlayer 等）：空 params，agent 需自行补全 targets
      out.push({
        description: `回应【${info.skillId}】`,
        message: respondMsg(info.skillId, {}),
        validTargets: [],
        category: 'respond',
      });
    }
  }
}
