// src/client/headless/availableActions.ts
// 枚举当前座次可执行操作。纯函数，零副作用。
// 复用 gameViewHelpers 的 isActiveAction / findUseActionForCard / derivePlayRules / buildPlayParams。
import type {
  Card,
  GameView,
  ActionContext,
  ClientMessage as EngineClientMessage,
  Json,
  TargetFilter,
} from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import type { AvailableAction } from './types';
import {
  isActiveAction,
  hasUseEntry,
  findUseActionForCard,
  findAltActionsForCard,
  derivePlayRules,
  buildPlayParams,
  extractCardFilter,
  type PlayRules,
} from '../utils/gameViewHelpers';
import { 基本牌列表, 锦囊牌列表, 装备牌列表 } from '../../engine/data/card-defs';
import { viewSlashTargetMax } from '../../engine/rules/action-active';
import { resolveTargetSelection, validateTargetSelection } from '../../engine/rules/target-selection';

/** 产出牌的真实 CardDef(type/subtype),供转化动作查找同源 use action。
 * 不能沿用原料牌的 type：装备原料(青釭剑)+普通牌在丈八组合中若沿用
 * type='装备牌',会先匹配「装备通用」而不是产出杀的 action，生成缺 targets 的坏动作。 */
const CARD_DEFS_BY_NAME = new Map(
  [...基本牌列表, ...锦囊牌列表, ...装备牌列表].map((def) => [def.name, def]),
);

function asProducedCard(source: Card, outputName: string): Card {
  const def = CARD_DEFS_BY_NAME.get(outputName);
  return {
    ...source,
    name: outputName,
    ...(def ? { type: def.type, subtype: def.subtype } : {}),
  };
}

/** 从 use action 的 prompt 取 targetFilter（useCardAndTarget/selectTarget 才有）。 */
function getTargetFilter(prompt: SkillActionDef['prompt']): TargetFilter | null {
  if (prompt.type === 'useCardAndTarget' || prompt.type === 'selectTarget') {
    return prompt.targetFilter;
  }
  return null;
}

function getSelfTarget(prompt: SkillActionDef['prompt']): boolean {
  return prompt.type === 'useCardAndTarget' ? !!prompt.selfTarget : false;
}

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

/** 目标数上下界(prompt.targetFilter 的投影)。
 *  仅在「需要目标且非自动自身目标」时给值:min 缺省 1(不设字段),max 缺省 1(不设字段)。
 *  引擎 validate 用同一份 targetFilter 判定,AI 少了这个下界就只会填 1 个目标 →
 *  离间(两名男性角色)一类多目标技能恒拒。 */
function targetBounds(
  targetFilter: TargetFilter | null | undefined,
  rules: PlayRules,
): { minTarget?: number; maxTarget?: number } {
  if (!rules.needsTarget || rules.selfTarget) return {};
  const min = targetFilter?.min ?? 1;
  const max = targetFilter?.max ?? 1;
  return {
    ...(min > 1 ? { minTarget: min } : {}),
    ...(max > 1 ? { maxTarget: max } : {}),
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
    const targetFilter = getTargetFilter(action.prompt);
    const rules = derivePlayRules(targetFilter, getSelfTarget(action.prompt));
    // 算合法目标（allowSelf 时含自己）
    const validTargets = computeValidTargets(view, seatIndex, targetFilter, rules);
    // 需要目标但无合法目标(如距离不够),跳过此牌
    if (rules.needsTarget && !rules.selfTarget && validTargets.length === 0) continue;
    // 构造示例 message：无目标牌直接完整；有目标牌 targets 待 agent 补全
    const sampleParams = rules.selfTarget
      ? buildPlayParams(view.players, seatIndex, card, rules, null, null)
      : rules.needsTarget && !rules.hasSlots
        ? { cardId: card.id }
        : buildPlayParams(view.players, seatIndex, card, rules, null, null);
    const message: EngineClientMessage = {
      skillId: action.skillId,
      actionType: 'use',
      ownerId: seatIndex,
      params: sampleParams ?? { cardId: card.id },
      baseSeq: 0,
    };
    const cardDesc = `${card.suit}${card.rank}`;
    // 杀受方天画戟(最后一张手牌)/天义/界疠火放宽目标数上限;其余牌默认 1。
    const slashMax =
      card.name === '杀' && rules.needsTarget && !rules.selfTarget
        ? viewSlashTargetMax(view, seatIndex, card)
        : undefined;
    const bounds = targetBounds(targetFilter, rules);
    result.push({
      description:
        rules.needsTarget && !rules.selfTarget
          ? slashMax && slashMax > 1
            ? `使用【${card.name}】(${cardDesc}) 选择目标(最多${slashMax}个)`
            : `使用【${card.name}】(${cardDesc}) 选择目标`
          : `使用【${card.name}】(${cardDesc})`,
      message,
      validTargets,
      category: 'play',
      ...bounds,
      ...(slashMax !== undefined ? { maxTarget: slashMax } : {}),
    });
  }
  return result;
}

/**
 * 枚举转化类技能动作(武圣/丈八蛇矛)。
 * transform action 的 prompt.type 是 useCardAndTarget,有 cardFilter + targetFilter。
 * 提交格式:主 action(杀.use) + preceding(transform)。
 * - 单卡转化(武圣,min=1):每张匹配牌一个 action,cardId 为影子 id `${原id}#skillId`。
 * - 多卡转化(丈八蛇矛,min>=2):组合数大,只生成描述性 action 提示 agent。
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
  const pendingSlot = view.pending;
  const pendingAtomType = (pendingSlot?.atom as { type?: string })?.type;
  const pendingReqType = (pendingSlot?.atom as { requestType?: string })?.requestType;
  const pendingRequestedName = (() => {
    if (!pendingSlot) return null;
    if (pendingSlot.target !== seatIndex && pendingSlot.target >= 0) return null;
    if (pendingAtomType?.startsWith('询问')) return pendingAtomType.slice(2) || null;
    if (pendingAtomType === '请求回应' && pendingReqType) {
      const sep = pendingReqType.search(/[/_]/);
      return (sep >= 0 ? pendingReqType.slice(0, sep) : pendingReqType) || null;
    }
    return null;
  })();
  const isRespondCtx = pendingRequestedName !== null;

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

    if (minCards > 1) {
      // 多卡转化(丈八蛇矛/乱击/界乱击):为每对匹配手牌生成一个具体 action,
      // 主 action params.cardId = 影子 id(`${id1}#${id2}#skillId`),
      // preceding transform 携带 cardIds=[id1,id2];agent 仅需补 targets。
      // (回归 yrjQ7X:旧实现只生成 params={} 的描述性 action + 空 validTargets,
      //  agent 无法构造合法 preceding/影子 cardId → 丈八蛇矛完全不可用。)
      const matchingCards = me.hand.filter(filter);
      // 组合约束(乱击/界乱击:两张牌同花色)。单卡 filter 表达不了「两张牌之间」的约束,
      // 缺了它客户端会枚举出引擎必拒的组合 —— AI 的 pickBestAction 是确定性的,
      // 反复挑中同一非法组合就永久空转(扫描实测 378 个组合里大量被拒)。
      const comboFilter = cardFilter.comboFilter;
      const combosOk = (c1: Card, c2: Card): boolean => !comboFilter || comboFilter([c1, c2]);

      // 回应路径(被询问杀 / 请求回应 杀/respondKill):两张牌当【杀】打出,无目标,
      // 主 action = 杀.respond。与单卡分支同构——旧实现整段缺少回应路径,多卡分支
      // 无条件发 use → 引擎 validate 拒「不是你的回合」,丈八蛇矛/界父魂 在
      // 南蛮入侵/决斗 的询问杀窗口里拿不到任何动作(浏览器 handleTransformPlay 有
      // respond 分支,只有无头/AI 客户端整类不可用)。
      if (isRespondCtx) {
        for (let i = 0; i < matchingCards.length; i++) {
          for (let j = i + 1; j < matchingCards.length; j++) {
            const c1 = matchingCards[i];
            const c2 = matchingCards[j];
            if (!combosOk(c1, c2)) continue;
            const wrapperName = action.transform(c1).name;
            if (wrapperName !== pendingRequestedName) continue; // 产出牌名 = 请求牌名时可用
            const shadowCardId = `${c1.id}#${c2.id}#${action.skillId}`;
            const desc = `${c1.suit}${c1.rank}+${c2.suit}${c2.rank}`;
            result.push({
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
                    params: { cardIds: [c1.id, c2.id] },
                  },
                ],
                baseSeq: 0,
              },
              validTargets: [],
              category: 'transform',
            });
          }
        }
        continue;
      }

      const targetFilter = getTargetFilter(action.prompt);
      const rules = derivePlayRules(targetFilter, getSelfTarget(action.prompt));
      for (let i = 0; i < matchingCards.length; i++) {
        for (let j = i + 1; j < matchingCards.length; j++) {
          const c1 = matchingCards[i];
          const c2 = matchingCards[j];
          if (!combosOk(c1, c2)) continue;
          // 产出牌名由 transform 回调**逐组合**求值(与单卡分支同判据):丈八蛇矛 → 杀,
          // 乱击/界乱击 → 万箭齐发;多向转化技(产出牌名随组合变化)不能只按
          // matchingCards[0] 取一次。硬编码 '杀' 会让非杀产出的主 action 恒为 杀.use,
          // 引擎读影子卡名 validate 恒拒「不是杀」→ 该转化技整类不可用。
          const wrapperName = action.transform(c1).name;
          // 产出牌门(与单卡分支对称):产出牌无主动 use 入口(闪/无懈可击 等
          // timing='生效前')、或产出牌的 use action 未激活(桃 需已受伤)时不枚举
          // 必拒动作;目标语义取产出牌自己的 use action,而非 transform 自身的
          // targetFilter(那是为原料牌方向设计的)。
          const produced = findUseActionForCard(skillActions, asProducedCard(c1, wrapperName));
          if (!hasUseEntry({ name: wrapperName })) continue;
          if (produced && !isActiveAction(produced, ctx)) continue;
          const cardTargetFilter = produced ? getTargetFilter(produced.prompt) : targetFilter;
          const cardRules = produced
            ? derivePlayRules(cardTargetFilter, getSelfTarget(produced.prompt))
            : rules;
          const validTargets = computeValidTargets(view, seatIndex, cardTargetFilter, cardRules);
          // 需要目标但无合法目标(如距离不够)→ 跳过该组合
          if (cardRules.needsTarget && !cardRules.selfTarget && validTargets.length === 0) continue;
          const shadowCardId = `${c1.id}#${c2.id}#${action.skillId}`;
          const desc = `${c1.suit}${c1.rank}+${c2.suit}${c2.rank}`;
          const bounds = targetBounds(cardTargetFilter, cardRules);
          const slashMax =
            wrapperName === '杀' && cardRules.needsTarget && !cardRules.selfTarget
              ? viewSlashTargetMax(view, seatIndex, { name: '杀' })
              : undefined;
          // selfTarget 产出牌(桃/酒):与单卡分支/ buildPlayParams 同源预填 targets=[自己]
          const mainParams: EngineClientMessage['params'] = cardRules.selfTarget
            ? { cardId: shadowCardId, targets: [seatIndex] }
            : { cardId: shadowCardId };
          result.push({
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
                  params: { cardIds: [c1.id, c2.id] },
                },
              ],
              baseSeq: 0,
            },
            validTargets,
            category: 'transform',
            ...bounds,
            ...(slashMax !== undefined ? { maxTarget: slashMax } : {}),
          });
        }
      }
      continue;
    }

    // 单卡转化(武圣/龙胆):每张匹配牌生成一个 action
    const matchingCards = me.hand.filter(filter);

    // 回应路径:转化后按请求牌名打出,无目标,主 action=<请求牌名>.respond
    if (isRespondCtx) {
      for (const card of matchingCards) {
        const wrapperName = action.transform ? action.transform(card).name : '杀';
        if (wrapperName !== pendingRequestedName) continue; // 仅转化后牌名 = 请求牌名时可用
        const shadowCardId = `${card.id}#${action.skillId}`;
        const cardDesc = `${card.suit}${card.rank}`;
        result.push({
          description: `${action.skillId}转化【${wrapperName}】(${cardDesc})打出`,
          message: {
            skillId: wrapperName,
            actionType: 'respond',
            ownerId: seatIndex,
            params: { cardId: shadowCardId },
            preceding: [
              {
                skillId: action.skillId,
                actionType: action.actionType,
                params: { cardId: card.id },
              },
            ],
            baseSeq: 0,
          },
          validTargets: [],
          category: 'transform',
        });
      }
      continue;
    }

    const targetFilter = getTargetFilter(action.prompt);
    const rules = derivePlayRules(targetFilter, getSelfTarget(action.prompt));
    for (const card of matchingCards) {
      const wrapperName = action.transform ? action.transform(card).name : '杀';
      const shadowCardId = `${card.id}#${action.skillId}`;

      // 目标语义由**产出牌自己的 use action** 决定(与出牌分支同源),而非 transform action 的
      // targetFilter(那是为出杀方向设计的)。界龙胆 四向转化:酒→桃 产出【桃】(selfTarget,
      // 自动以自己为目标)、桃→酒 产出【酒】(无目标牌);沿用 transform 的「其他角色」目标
      // 会枚举出引擎必拒的动作(「只能对自己使用酒」/「桃只能对受伤角色使用」)。
      // 产出牌无 use action(闪/无懈 等回应牌)时回退到 transform 自身规则。
      const produced = findUseActionForCard(skillActions, asProducedCard(card, wrapperName));
      // 产出牌在出牌阶段必须真的能用:闪/无懈可击(timing='生效前')没有主动 use 入口,
      // 「当闪使用」在出牌阶段无意义(引擎无对应 action,提交恒拒);产出牌的 use action
      // 未激活(如 桃 需自己已受伤)时同理 —— 不枚举必然被拒的动作。
      if (!hasUseEntry({ name: wrapperName })) continue;
      if (produced && !isActiveAction(produced, ctx)) continue;
      const cardTargetFilter = produced ? getTargetFilter(produced.prompt) : targetFilter;
      const cardRules = produced
        ? derivePlayRules(cardTargetFilter, getSelfTarget(produced.prompt))
        : rules;

      // 算合法目标（allowSelf 时含自己，与 enumeratePlayActions 同模式）
      const validTargets = computeValidTargets(view, seatIndex, cardTargetFilter, cardRules);
      // 需要目标但无合法目标(如距离不够),跳过此牌
      if (cardRules.needsTarget && !cardRules.selfTarget && validTargets.length === 0) continue;

      const cardDesc = `${card.suit}${card.rank}`;
      // 转化杀同样受目标数上限约束(默认1;方天画戟看手牌数,天义拼点赢放宽到2)。
      // 转化杀非火杀,不传 damageType(界疠火仅对火杀生效)。
      const slashMax =
        wrapperName === '杀' && cardRules.needsTarget && !cardRules.selfTarget
          ? viewSlashTargetMax(view, seatIndex, { name: '杀' })
          : undefined;
      // selfTarget 产出牌(桃/酒):与 buildPlayParams 同源预填 targets=[自己]
      const mainParams: EngineClientMessage['params'] = cardRules.selfTarget
        ? { cardId: shadowCardId, targets: [seatIndex] }
        : { cardId: shadowCardId };
      result.push({
        description:
          wrapperName === '杀' && slashMax && slashMax > 1
            ? `${action.skillId}转化【${wrapperName}】(${cardDesc}) (最多${slashMax}目标)`
            : `${action.skillId}转化【${wrapperName}】(${cardDesc})`,
        message: {
          skillId: wrapperName,
          actionType: 'use',
          ownerId: seatIndex,
          params: mainParams,
          preceding: [
            {
              skillId: action.skillId,
              actionType: action.actionType,
              params: { cardId: card.id },
            },
          ],
          baseSeq: 0,
        },
        validTargets,
        category: 'transform',
        ...(slashMax !== undefined ? { maxTarget: slashMax } : {}),
      });
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
      const allowSelf = prompt.allowSelf !== false;
      const targetFilterFn = prompt.targetFilter;
      const validTargets: number[] = [];
      for (const p of view.players) {
        if (!p.alive) continue;
        if (p.index === seatIndex && !allowSelf) continue;
        if (targetFilterFn && !targetFilterFn(view, p.index)) continue;
        validTargets.push(p.index);
      }
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
      const targetFilter = getTargetFilter(action.prompt);
      const rules = derivePlayRules(targetFilter, getSelfTarget(action.prompt));
      // 替代出法也要按自身 prompt 派生目标规则(与主出牌分支同源):
      // 义绝/界断粮 等 useCardAndTarget 型替代出法需要目标,旧实现固定
      // validTargets=[] 且 params 只有 cardId → AI 提交缺目标,引擎恒拒
      // 「需要选择目标」,整类替代出法在无头/AI 客户端不可用。
      const validTargets = computeValidTargets(view, seatIndex, targetFilter, rules);
      if (rules.needsTarget && !rules.selfTarget && validTargets.length === 0) continue;
      const cardDesc = `${card.suit}${card.rank}`;
      const sampleParams = rules.selfTarget
        ? buildPlayParams(view.players, seatIndex, card, rules, null, null)
        : rules.needsTarget && !rules.hasSlots
          ? { cardId: card.id }
          : buildPlayParams(view.players, seatIndex, card, rules, null, null);
      const bounds = targetBounds(targetFilter, rules);
      result.push({
        description:
          bounds.minTarget && bounds.minTarget > 1
            ? `${action.label}(${cardDesc}) 选择目标(需 ${bounds.minTarget} 个)`
            : `${action.label}(${cardDesc})`,
        message: {
          skillId: action.skillId,
          actionType: action.actionType,
          ownerId: seatIndex,
          params: sampleParams ?? { cardId: card.id },
          baseSeq: 0,
        },
        validTargets,
        category: 'play',
        ...bounds,
      });
    }
  }
  return result;
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
    if (
      prompt.type !== 'confirm' &&
      prompt.type !== 'selectTarget' &&
      prompt.type !== 'choosePlayer' &&
      prompt.type !== 'chooseOption'
    ) {
      continue;
    }
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
    //   selectTarget 用 targetFilter.filter(本地函数引用可用)。
    let validTargets: number[];
    if (prompt.type === 'choosePlayer') {
      validTargets =
        prompt.candidates ??
        view.players
          .filter((p) => p.alive && (!prompt.filter || prompt.filter(view, p.index)))
          .map((p) => p.index);
    } else {
      const filter = prompt.targetFilter.filter;
      validTargets = view.players
        .filter((p) => p.alive && (!filter || filter(view, p.index)))
        .map((p) => p.index);
    }
    if (validTargets.length === 0) continue;

    // paramVariants(强袭代价 等):每个变体一个 action;缺省单个无额外参数的变体。
    // 多选分支(min>1)同样要展开,否则丢必填 cost/cardId(见下)。
    const variants =
      prompt.type === 'selectTarget' && prompt.paramVariants?.length
        ? prompt.paramVariants
        : [{ label: '', params: {} as Record<string, Json> }];
    // 变体声明的代价牌(强袭·弃武器):按「每个候选牌 × 每个合法目标」展开并预填 cardId,
    // 否则 agent 提交缺 cardId 被引擎恒拒「弃武器需要 cardId」(浏览器侧同源:选中武器牌后提交)。
    const equipIds = new Set(
      Object.values(me.equipment ?? {}).filter((id): id is string => typeof id === 'string'),
    );
    const costCardsOf = (variant: (typeof variants)[number]): Array<Card | undefined> =>
      variant.cardFilter
        ? [
            ...(me.hand ?? []).filter((c) => variant.cardFilter!(c)),
            ...[...equipIds]
              .map((id) => view.cardMap[id])
              .filter((c): c is Card => !!c && variant.cardFilter!(c)),
          ]
        : [undefined];

    // 多目标技能(selectTarget.targetFilter.min>1 或 choosePlayer.min>1,如「两名男性角色」类):
    // 逐目标展开的 action 每个只带 1 个目标 → 引擎 validate 必拒「目标数不足」
    // (choosePlayer 同理:prompt.min>1 时单候选展开同样必拒)。
    // 改为描述性 action:validTargets 给全集,minTarget/maxTarget 给边界,
    // agent 据此选 minTarget..maxTarget 个;paramVariants 按变体(× 代价牌)各生成
    // 一个描述性 action(与 min=1 的变体展开形态一致),携带 cost/cardId。
    const multiMin =
      prompt.type === 'selectTarget'
        ? (prompt.targetFilter.min ?? 1)
        : prompt.type === 'choosePlayer'
          ? (prompt.min ?? 1)
          : 1;
    if (multiMin > 1) {
      const max =
        prompt.type === 'selectTarget'
          ? (prompt.targetFilter.max ?? multiMin)
          : prompt.type === 'choosePlayer'
            ? (prompt.max ?? multiMin)
            : multiMin;
      for (const variant of variants) {
        const suffix = variant.label ? `(${variant.label})` : '';
        const costCards = costCardsOf(variant);
        if (variant.cardFilter && costCards.length === 0) continue; // 无代价牌 → 该变体不可用
        for (const costCard of costCards) {
          const cardSuffix = costCard ? `(${costCard.suit}${costCard.rank})` : '';
          result.push({
            description: `发动【${action.label}】${suffix}${cardSuffix}(选 ${multiMin}${max > multiMin ? `-${max}` : ''} 个目标)`,
            message: {
              ...base,
              // targets 留空由 agent 从 validTargets 中选 minTarget..maxTarget 个填入
              params: {
                targets: [],
                ...variant.params,
                ...(costCard ? { cardId: costCard.id } : {}),
              },
            },
            validTargets,
            category: 'play',
            minTarget: multiMin,
            ...(max > 1 ? { maxTarget: max } : {}),
          });
        }
      }
      continue;
    }

    for (const t of validTargets) {
      const targetName = view.players[t]?.name ?? `P${t}`;
      for (const variant of variants) {
        const suffix = variant.label ? `(${variant.label})` : '';
        const costCards = costCardsOf(variant);
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
  // 出牌阶段:当前玩家可主动结束回合(无阻塞 pending 时)
  if (
    view.currentPlayerIndex === seatIndex &&
    view.phase === '出牌' &&
    (!view.pending || view.pending.isBlocking === false)
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
    // 有 preceding 时原牌是转化原料、产出牌名 = 技能名,原牌名不足为凭(武圣 红牌当杀)。
    // 没有 preceding 时,同名的 useCardAndTarget 出牌(杀本体)里选中的牌就是正在使用的牌;
    // 而技能自带 cardFilter 的代价牌(离间 弃一张牌 + 选两名男性)动作名是技能名,
    // 那张牌不是被使用的牌——按杀解释会让 min=max=2 塌成 1,引擎随即拒
    // 「需要选择两名男性角色」。故用「动作名 === 牌名」判定是否同一张牌。
    const slashScaled = !!message.preceding?.length || source?.name === message.skillId;
    const card = source
      ? { ...source, countsAsSlash: slashScaled }
      : ingredient
        ? { ...ingredient, name: message.skillId, countsAsSlash: slashScaled }
        : undefined;
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
