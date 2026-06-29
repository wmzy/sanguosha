// src/client/headless/availableActions.ts
// 枚举当前座次可执行操作。纯函数，零副作用。
// 复用 gameViewHelpers 的 isActiveAction / findUseActionForCard / derivePlayRules / buildPlayParams。
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
  derivePlayRules,
  buildPlayParams,
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
    const rules = derivePlayRules(getTargetFilter(action.prompt), getSelfTarget(action.prompt));
    // 算合法目标
    const validTargets: number[] = [];
    if (rules.needsTarget && !rules.hasSlots && !rules.selfTarget) {
      for (const p of view.players) {
        if (p.index === seatIndex || !p.alive) continue;
        const params = buildPlayParams(view.players, seatIndex, card, rules, p.name, null);
        if (params) validTargets.push(p.index);
      }
    } else if (rules.selfTarget) {
      validTargets.push(seatIndex);
    }
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

/** 主入口：枚举当前座次可执行的操作（出牌阶段主动出牌）。 */
export function enumerateAvailableActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  if (!view) return [];
  return enumeratePlayActions(view, seatIndex, skillActions);
}
