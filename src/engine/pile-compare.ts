import type { SkillPhase, SkillContext, GameState, Condition } from './types';

/** 三国杀卡牌点数：K=13 > Q=12 > ... > 2=2 > A=1 */
const RANK_VALUES: Record<string, number> = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5,
  6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 11, Q: 12, K: 13,
};

export function getRankValue(rank: string): number {
  return RANK_VALUES[rank] ?? 0;
}

/**
 * 创建拼点 SkillPhase 序列。发起方和目标方各选一张手牌弃掉，比较点数。
 * 结果: ctx.localVars.{prefix}Result = 'win'(发起方大) | 'lose'
 *       ctx.localVars.{prefix}InitiatorCard / TargetCard = 牌ID
 */
export function createPileComparePhases(
  ctx: SkillContext,
  state: GameState,
  options?: {
    initiator?: string;
    target?: string;
    varPrefix?: string;
  },
): SkillPhase[] {
  const initiator = options?.initiator ?? ctx.self;
  const target = options?.target ?? ctx.target;
  const prefix = options?.varPrefix ?? 'pileCompare';

  if (!target) return [];

  const targetPlayer = state.players[target];
  if (!targetPlayer || !targetPlayer.info.alive || targetPlayer.hand.length === 0) return [];

  const initiatorPlayer = state.players[initiator];
  if (!initiatorPlayer || !initiatorPlayer.info.alive || initiatorPlayer.hand.length === 0) return [];

  return [
    {
      type: 'prompt',
      text: `拼点：请选择一张手牌`,
      options: [{ type: 'selectCards', from: '手牌', min: 1, max: 1 }],
    },
    {
      type: 'atoms',
      ops: [
        { type: '设置上下文变量', key: `${prefix}InitiatorCard`, value: { $: 'ctx', path: 'choice.cardIds.0' } as const },
        { type: '弃置', player: initiator, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const },
      ],
    },
    {
      type: 'prompt',
      text: `拼点：请选择一张手牌`,
      options: [{ type: 'selectCards', from: '手牌', min: 1, max: 1 }],
    },
    {
      type: 'atoms',
      ops: [
        { type: '设置上下文变量', key: `${prefix}TargetCard`, value: { $: 'ctx', path: 'choice.cardIds.0' } as const },
        { type: '弃置', player: target, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const },
      ],
    },
    {
      type: 'condition',
      check: {
        gt: [
          { $: 'cardProp', card: { $: 'ctx', path: `localVars.${prefix}InitiatorCard` }, prop: 'rankValue' },
          { $: 'cardProp', card: { $: 'ctx', path: `localVars.${prefix}TargetCard` }, prop: 'rankValue' },
        ],
      } as Condition,
      then: [
        { type: 'atoms', ops: [{ type: '设置上下文变量', key: `${prefix}Result`, value: 'win' }] },
      ],
      else: [
        { type: 'atoms', ops: [{ type: '设置上下文变量', key: `${prefix}Result`, value: 'lose' }] },
      ],
    },
  ];
}
