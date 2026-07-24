// src/client/headless/availableActions.ts
// 枚举当前座次可执行操作。纯函数，零副作用。
// 复用 gameViewHelpers 的 isActiveAction / findUseActionForCard / derivePlayRules / buildPlayParams。
import type {
  GameView,
  ActionContext,
  ClientMessage as EngineClientMessage,
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
  type PlayRules,
} from '../utils/gameViewHelpers';

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
  const validTargets: number[] = [];
  if (rules.needsTarget && !rules.hasSlots && !rules.selfTarget) {
    const allowSelf = !!targetFilter?.allowSelf;
    for (const p of view.players) {
      if (!p.alive) continue;
      if (p.index === seatIndex && !allowSelf) continue;
      if (targetFilter?.filter && !targetFilter.filter(view, p.index)) continue;
      validTargets.push(p.index);
    }
  } else if (rules.selfTarget) {
    validTargets.push(seatIndex);
  }
  return validTargets;
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
    result.push({
      description:
        rules.needsTarget && !rules.selfTarget
          ? `使用【${card.name}】(${cardDesc}) 选择目标`
          : `使用【${card.name}】(${cardDesc})`,
      message,
      validTargets,
      category: 'play',
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

  for (const action of skillActions) {
    if (action.actionType !== 'transform') continue;
    if (!isActiveAction(action, ctx)) continue;
    const filter = extractCardFilter(action.prompt);
    if (!filter) continue;
    // cardFilter min/max 来自 prompt(transform 的 prompt 一定是 useCardAndTarget)
    const cardFilter = action.prompt.type === 'useCardAndTarget' ? action.prompt.cardFilter : null;
    if (!cardFilter) continue;
    const minCards = cardFilter.min ?? 1;

    if (minCards > 1) {
      // 多卡转化(丈八蛇矛):组合数大,只生成描述性 action,validTargets 为空
      const sampleCard = me.hand.find(filter);
      const wrapperName =
        sampleCard && action.transform ? action.transform(sampleCard).name : '杀';
      result.push({
        description: `${action.skillId}转化【${wrapperName}】(选 ${minCards} 张手牌)`,
        message: {
          skillId: wrapperName,
          actionType: 'use',
          ownerId: seatIndex,
          params: {},
          baseSeq: 0,
        },
        validTargets: [],
        category: 'transform',
      });
      continue;
    }

    // 单卡转化(武圣):每张匹配牌生成一个 action
    const matchingCards = me.hand.filter(filter);
    const targetFilter = getTargetFilter(action.prompt);
    const rules = derivePlayRules(targetFilter, getSelfTarget(action.prompt));
    for (const card of matchingCards) {
      const wrapperName = action.transform ? action.transform(card).name : '杀';
      const shadowCardId = `${card.id}#${action.skillId}`;

      // 算合法目标（allowSelf 时含自己，与 enumeratePlayActions 同模式）
      const validTargets = computeValidTargets(view, seatIndex, targetFilter, rules);
      // 需要目标但无合法目标(如距离不够),跳过此牌
      if (rules.needsTarget && !rules.selfTarget && validTargets.length === 0) continue;

      const cardDesc = `${card.suit}${card.rank}`;
      result.push({
        description: `${action.skillId}转化【${wrapperName}】(${cardDesc})`,
        message: {
          skillId: wrapperName,
          actionType: 'use',
          ownerId: seatIndex,
          params: { cardId: shadowCardId },
          preceding: [
            {
              skillId: action.skillId,
              actionType: 'transform',
              params: { cardId: card.id },
            },
          ],
          baseSeq: 0,
        },
        validTargets,
        category: 'transform',
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
    const alts = findAltActionsForCard(skillActions, card);
    for (const action of alts) {
      if (!isActiveAction(action, ctx)) continue;
      const cardDesc = `${card.suit}${card.rank}`;
      result.push({
        description: `${action.label}(${cardDesc})`,
        message: {
          skillId: action.skillId,
          actionType: action.actionType,
          ownerId: seatIndex,
          params: { cardId: card.id },
          baseSeq: 0,
        },
        validTargets: [],
        category: 'play',
      });
    }
  }
  return result;
}

/** 主入口：枚举当前座次可执行的操作（出牌/转化/替代出牌/分配/结束出牌阶段）。 */
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
  return actions;
}
