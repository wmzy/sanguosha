import type { SkillContext, GameEvent, TriggerRule, GameState } from './types';

/**
 * 从事件和触发规则构建技能执行上下文。
 * 提取常见事件字段（target/source/cardId）到上下文中。
 */
export function buildSkillContext(
  _state: GameState,
  event: GameEvent,
  trigger: TriggerRule,
): SkillContext {
  const e = event as Record<string, unknown>;
  return {
    skillId: trigger.skillId,
    self: trigger.player,
    target: (e['target'] as string | undefined) ?? (e['defender'] as string | undefined),
    source: (e['source'] as string | undefined) ?? (e['attacker'] as string | undefined),
    sourceCard: (e['cardId'] as string | undefined),
    event,
    localVars: {},
  };
}
