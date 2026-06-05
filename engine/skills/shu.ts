import type { SkillDef, GameState, SkillPhase } from '../types';
import { registerSkill } from '../skill';

// ==================== 刘备 ====================

registerSkill({
  id: '仁德',
  name: '仁德',
  description: '出牌阶段，你可以将任意数量的手牌交给其他角色。每阶段以此法给出两张或更多后，你回复1点体力。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '仁德：选择要送出的手牌和目标角色',
        options: [
          { type: 'selectCards', from: 'hand', min: 1, max: 99 },
          { type: 'selectPlayer' },
        ],
      },
      {
        type: 'foreach',
        collection: { $: 'ctx', path: 'choice.cardIds' },
        varName: 'giveCardId',
        body: [
          {
            type: 'atoms',
            ops: [{
              type: 'moveCard',
              cardId: { $: 'ctx', path: 'localVars.giveCardId' },
              from: { zone: 'hand', player: _ctx.self },
              to: { zone: 'hand', player: { $: 'ctx', path: 'choice.target' } },
            }],
          },
        ],
      },
      {
        type: 'condition',
        check: {
          and: [
            { gte: [{ $: 'count', source: { $: 'ctx', path: 'choice.cardIds' } }, 2] },
            { not: { hasVar: { player: _ctx.self, key: '仁德/healedThisPhase' } } },
          ],
        },
        then: [
          {
            type: 'atoms',
            ops: [
              { type: 'heal', target: _ctx.self, amount: 1 },
              { type: 'setVar', player: _ctx.self, key: '仁德/healedThisPhase', value: true },
            ],
          },
        ],
      },
    ];
  },
});

registerSkill({
  id: '激将',
  name: '激将',
  description: '主公技，出牌阶段，你可以令一名蜀势力角色替你使用【杀】。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 关羽 ====================

registerSkill({
  id: '武圣',
  name: '武圣',
  description: '你可以将一张红色手牌当【杀】使用或打出。',
  trigger: {
    event: 'killResponse',
    source: 'character',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 张飞 ====================

registerSkill({
  id: '咆哮',
  name: '咆哮',
  description: '锁定技，出牌阶段，你使用【杀】无次数限制。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 赵云 ====================

registerSkill({
  id: '龙胆',
  name: '龙胆',
  description: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
  trigger: {
    event: 'killResponse',
    source: 'character',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 诸葛亮 ====================

registerSkill({
  id: '观星',
  name: '观星',
  description: '准备阶段，你可以观看牌堆顶的X张牌（X为存活角色数且至多为5），并将任意数量的牌以任意顺序置于牌堆顶，其余以任意顺序置于牌堆底。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '准备',
    optional: true,
  },
  handler(_ctx, _state) {
    const aliveCount = _state.playerOrder.filter(n => _state.players[n].info.alive).length;
    const N = Math.min(aliveCount, 5);
    const topCards = _state.zones.deck.slice(0, N);
    if (topCards.length === 0) return [];
    return buildRearrangeTree(_state, topCards, 0, [], [], _ctx.self);
  },
});

/** 递归构建观星的 prompt + condition 决策树 */
function buildRearrangeTree(
  state: GameState,
  cards: string[],
  index: number,
  topSoFar: string[],
  bottomSoFar: string[],
  player: string,
): SkillPhase[] {
  if (index >= cards.length) {
    return [{
      type: 'atoms',
      ops: [{
        type: 'rearrangeDeck' as const,
        player,
        topCardIds: topSoFar,
        bottomCardIds: bottomSoFar,
      }],
    }];
  }

  const card = state.cardMap[cards[index]];
  const label = `${card.suit}${card.rank} ${card.name}`;

  return [
    {
      type: 'prompt',
      text: `观星：${label}（第${index + 1}/${cards.length}张）放到`,
      options: [
        { label: '牌堆顶', value: 'top' },
        { label: '牌堆底', value: 'bottom' },
      ],
    },
    {
      type: 'condition',
      check: { equals: [{ $: 'ctx', path: 'choice' }, 'top'] },
      then: buildRearrangeTree(state, cards, index + 1, [...topSoFar, cards[index]], bottomSoFar, player),
      else: buildRearrangeTree(state, cards, index + 1, topSoFar, [...bottomSoFar, cards[index]], player),
    },
  ];
}

// ==================== 马超 ====================

registerSkill({
  id: '马术',
  name: '马术',
  description: '锁定技，你计算与其他角色的距离时，始终-1。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'setVar', player: ctx.self, key: 'distanceBonus', value: -1 }] },
    ];
  },
});

registerSkill({
  id: '铁骑',
  name: '铁骑',
  description: '当你使用【杀】指定一名角色为目标后，你可以进行判定：若结果为红色，该角色不能使用【闪】。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    if (!_ctx.sourceCard) return [];
    const card = _state.cardMap[_ctx.sourceCard];
    if (!card || card.name !== '杀') return [];
    if (!_ctx.target) return [];
    return [
      { type: 'atoms', ops: [{ type: 'judge', player: _ctx.self }] },
      {
        type: 'condition',
        check: { equals: [{ $: 'ctx', path: 'localVars.judgeColor' }, 'red'] },
        then: [
          { type: 'atoms', ops: [{ type: 'addTag', player: _ctx.target!, tag: 'cannotDodge' }] },
        ],
      },
    ];
  },
});

// ==================== 黄月英 ====================

registerSkill({
  id: '集智',
  name: '集智',
  description: '当你使用一张非延时锦囊牌时，你可以摸一张牌。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
});

registerSkill({
  id: '奇才',
  name: '奇才',
  description: '锁定技，你使用锦囊牌无距离限制。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'addTag', player: ctx.self, tag: 'noTrickDistanceLimit' }] },
    ];
  },
} satisfies SkillDef);

// ==================== 黄忠 ====================

registerSkill({
  id: '烈弓',
  name: '烈弓',
  description: '当你使用【杀】指定目标后，若其手牌数≥你或体力值≥你，其不能使用【闪】。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
  },
  handler(_ctx, _state) {
    if (!_ctx.target || !_ctx.sourceCard) return [];
    const card = _state.cardMap[_ctx.sourceCard];
    if (!card || card.name !== '杀') return [];
    if (_ctx.target === _ctx.self) return [];

    const me = _state.players[_ctx.self];
    const target = _state.players[_ctx.target];
    if (!me || !target) return [];

    const targetHandGte = target.hand.length >= me.hand.length;
    const targetHpGte = target.health >= me.health;

    if (!targetHandGte && !targetHpGte) return [];

    return [
      { type: 'atoms', ops: [{ type: 'addTag', player: _ctx.target, tag: 'cannotDodge' }] },
    ];
  },
});

// ==================== 魏延 ====================

registerSkill({
  id: '狂骨',
  name: '狂骨',
  description: '锁定技，当你对距离1以内的角色造成伤害后，你回复1点体力。',
  trigger: {
    event: 'damageDealt',
    source: 'character',
  },
  handler(_ctx, _state) {
    if (_ctx.source !== _ctx.self) return [];
    if (!_ctx.target) return [];
    return [
      { type: 'atoms', ops: [{ type: 'heal', target: _ctx.self, amount: 1 }] },
    ];
  },
});

// ==================== 卧龙诸葛（火扩展包）====================

registerSkill({
  id: '八阵',
  name: '八阵',
  description: '锁定技，当你没有装备防具时，始终视为你装备着【八卦阵】。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(ctx, state) {
    const p = state.players[ctx.self];
    if (p.equipment.armor) return [];
    return [
      { type: 'atoms', ops: [{ type: 'addTag', player: ctx.self, tag: 'virtualArmor' }] },
    ];
  },
});

registerSkill({
  id: '火计',
  name: '火计',
  description: '你可以将一张红色手牌当【火攻】使用。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: '看破',
  name: '看破',
  description: '你可以将一张黑色手牌当【无懈可击】使用。',
  trigger: {
    event: 'trickResponse',
    source: 'character',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 庞统（火扩展包）====================

registerSkill({
  id: '连环',
  name: '连环',
  description: '你可以将一张梅花手牌当【铁索连环】使用或重铸。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: '涅槃',
  name: '涅槃',
  description: '限定技，当你处于濒死状态时，你可以弃置所有牌和判定区的牌，重置武将牌，摸三张牌并回复至3点体力。',
  trigger: {
    event: 'dying',
    source: 'character',
    optional: true,
  },
  handler(ctx, state) {
    if (state.players[ctx.self].vars['涅槃/used']) return [];
    const p = state.players[ctx.self];
    const allHandCards = [...p.hand];
    return [
      {
        type: 'atoms',
        ops: [
          { type: 'discard', player: ctx.self, cardIds: allHandCards },
          { type: 'draw', player: ctx.self, count: 3 },
          { type: 'setVar', player: ctx.self, key: '涅槃/used', value: true },
        ],
      },
      {
        type: 'condition',
        check: { lt: [{ $: 'var', player: ctx.self, key: 'health' }, 3] },
        then: [
          { type: 'atoms', ops: [{ type: 'heal', target: ctx.self, amount: 3 }] },
        ],
      },
    ];
  },
});

// ==================== 孟获（林扩展包）====================

registerSkill({
  id: '祸首',
  name: '祸首',
  description: '锁定技，【南蛮入侵】对你无效；你是任何【南蛮入侵】造成伤害的来源。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'addTag', player: ctx.self, tag: 'immune南蛮入侵' }] },
      { type: 'atoms', ops: [{ type: 'addTag', player: ctx.self, tag: '南蛮入侵来源' }] },
    ];
  },
});

registerSkill({
  id: '再起',
  name: '再起',
  description: '摸牌阶段，若你已受伤，你可以放弃摸牌并展示牌堆顶X张牌（X为你已损失体力值），每有一张红桃回复1点体力，然后弃掉这些红桃牌，将其余的牌收入手牌。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '摸牌',
    optional: true,
  },
  handler(ctx, state) {
    const p = state.players[ctx.self];
    const lost = p.maxHealth - p.health;
    if (lost <= 0) return [];
    return [
      {
        type: 'prompt',
        text: `再起：是否放弃摸牌，展示牌堆顶${lost}张牌？`,
        options: [
          { label: '放弃摸牌，展示', value: true },
          { label: '正常摸牌', value: false },
        ],
        defaultChoice: false,
      },
      {
        type: 'condition',
        check: { equals: [{ $: 'ctx', path: 'choice' }, true] },
        then: [
          { type: 'atoms', ops: [{ type: 'draw', player: ctx.self, count: lost }] },
          { type: 'atoms', ops: [{ type: 'setVar', player: ctx.self, key: '再起/skipNormalDraw', value: true }] },
        ],
      },
    ];
  },
});

// ==================== 祝融（林扩展包）====================

registerSkill({
  id: '巨象',
  name: '巨象',
  description: '锁定技，【南蛮入侵】对你无效；若其他角色使用的【南蛮入侵】在结算完时进入弃牌堆，你立即获得它。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'addTag', player: ctx.self, tag: 'immune南蛮入侵' }] },
      { type: 'atoms', ops: [{ type: 'addTag', player: ctx.self, tag: 'collect南蛮入侵' }] },
    ];
  },
});

registerSkill({
  id: '烈刃',
  name: '烈刃',
  description: '每当你使用【杀】造成伤害后，可与受伤害的角色拼点：若你赢，你获得对方的一张牌。',
  trigger: {
    event: 'damageDealt',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    if (_ctx.source !== _ctx.self) return [];
    if (!_ctx.target) return [];
    // 拼点机制需要引擎支持，当前返回空
    return [];
  },
});

// ==================== 姜维（山扩展包）====================

registerSkill({
  id: '挑衅',
  name: '挑衅',
  description: '出牌阶段，你可以指定一名使用【杀】能攻击到你的角色，该角色需对你使用一张【杀】，否则你弃其一张牌。每回合限一次。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '挑衅：选择一名能攻击到你的角色',
        options: [
          { type: 'selectPlayer' },
        ],
      },
    ];
  },
});

registerSkill({
  id: '志继',
  name: '志继',
  description: '觉醒技，回合开始阶段，若你没有手牌，你须回复1点体力或摸两张牌，然后减1点体力上限，并永久获得技能"观星"。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(ctx, state) {
    if (state.players[ctx.self].vars['志继/awakened']) return [];
    const p = state.players[ctx.self];
    if (p.hand.length > 0) return [];
    return [
      { type: 'atoms', ops: [{ type: 'setVar', player: ctx.self, key: '志继/awakened', value: true }] },
      {
        type: 'prompt',
        text: '志继觉醒：选择回复1点体力或摸两张牌',
        options: [
          { label: '回复1点体力', value: 'heal' },
          { label: '摸两张牌', value: 'draw' },
        ],
        defaultChoice: 'heal',
      },
      {
        type: 'condition',
        check: { equals: [{ $: 'ctx', path: 'choice' }, 'heal'] },
        then: [
          { type: 'atoms', ops: [{ type: 'heal', target: ctx.self, amount: 1 }] },
        ],
        else: [
          { type: 'atoms', ops: [{ type: 'draw', player: ctx.self, count: 2 }] },
        ],
      },
    ];
  },
});

// ==================== 刘禅（山扩展包）====================

registerSkill({
  id: '享乐',
  name: '享乐',
  description: '锁定技，当其他角色使用【杀】指定你为目标时，需额外弃置一张基本牌，否则该【杀】对你无效。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
  },
  handler(_ctx, _state) {
    if (!_ctx.sourceCard) return [];
    const card = _state.cardMap[_ctx.sourceCard];
    if (!card || card.name !== '杀') return [];
    if (!_ctx.target || _ctx.target !== _ctx.self) return [];
    const attacker = (_ctx.event as Record<string, unknown>)['player'] as string;
    if (!attacker || attacker === _ctx.self) return [];
    return [
      { type: 'atoms', ops: [{ type: 'addTag', player: attacker, tag: '享乐/discardBasic' }] },
    ];
  },
});

registerSkill({
  id: '放权',
  name: '放权',
  description: '你可以跳过出牌阶段，然后在回合结束时弃置一张手牌，令一名其他角色进行一个额外回合。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '放权：是否跳过出牌阶段？',
        options: [
          { label: '跳过出牌阶段', value: true },
          { label: '取消', value: false },
        ],
        defaultChoice: false,
      },
    ];
  },
});

registerSkill({
  id: '若愚',
  name: '若愚',
  description: '主公技，觉醒技，回合开始阶段，若你的体力是全场最少的（或之一），你须增加1点体力上限并回复1点体力，然后永久获得技能"激将"。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(ctx, state) {
    if (state.players[ctx.self].vars['若愚/awakened']) return [];
    const myHealth = state.players[ctx.self].health;
    const allHealths = state.playerOrder
      .filter(n => state.players[n].info.alive)
      .map(n => state.players[n].health);
    const minHealth = Math.min(...allHealths);
    if (myHealth > minHealth) return [];
    return [
      { type: 'atoms', ops: [{ type: 'setVar', player: ctx.self, key: '若愚/awakened', value: true }] },
    ];
  },
});
