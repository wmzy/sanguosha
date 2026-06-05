import type { SkillDef, SkillPhase } from '../types';
import { registerSkill } from '../skill';
import { getPlayer, getAlivePlayerNames } from '../state';

// ==================== 吕布 ====================

registerSkill({
  id: '无双',
  name: '无双',
  description: '锁定技，你使用的【杀】需两张【闪】才能抵消；与你进行【决斗】的角色每次需打出两张【杀】。',
  trigger: {
    event: 'killHit',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 貂蝉 ====================

registerSkill({
  id: '离间',
  name: '离间',
  description: '出牌阶段，你可以弃置一张手牌，令一名男性角色视为对另一名男性角色使用一张【决斗】。每阶段限一次。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(ctx, state) {
    if (!ctx.target || ctx.target === ctx.self) return [];
    const self = getPlayer(state, ctx.self);
    if (self.hand.length === 0) return [];

    const targetPlayer = getPlayer(state, ctx.target);
    if (targetPlayer.info.gender !== '男') return [];

    const males = getAlivePlayerNames(state).filter(p => {
      if (p === ctx.self) return false;
      if (p === ctx.target) return false;
      return getPlayer(state, p).info.gender === '男';
    });
    if (males.length === 0) return [];

    const duelAttacker = males[0];
    const duelDefender = ctx.target;
    const discardCardId = self.hand[0];

    const defenderPlayer = getPlayer(state, duelDefender);
    const validKills = defenderPlayer.hand.filter(id => state.cardMap[id]?.name === '杀');

    const phases = [
      {
        type: 'condition' as const,
        check: { not: { hasVar: { player: ctx.self, key: '离间/usedThisTurn' } } },
        then: [
          {
            type: 'atoms' as const,
            ops: [
              { type: 'discard' as const, player: ctx.self, cardIds: [discardCardId] },
              { type: 'setVar' as const, player: ctx.self, key: '离间/usedThisTurn', value: true },
            ],
          },
          {
            type: 'respond' as const,
            window: {
              type: 'duelResponse' as const,
              attacker: duelAttacker,
              defender: duelDefender,
              validCards: validKills,
              sourceCard: discardCardId,
            },
          },
        ],
      },
    ];

    return phases;
  },
});

registerSkill({
  id: '闭月',
  name: '闭月',
  description: '结束阶段，你可以摸一张牌。',
  trigger: {
    event: 'turnEnd',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
});

// ==================== 华佗 ====================

registerSkill({
  id: '急救',
  name: '急救',
  description: '你可以将一张红色手牌当【桃】使用。',
  trigger: {
    event: 'dyingResponse',
    source: 'character',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: '青囊',
  name: '青囊',
  description: '出牌阶段，你可以弃置一张手牌，令一名角色回复1点体力。每阶段限一次。',
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
        type: 'condition',
        check: { not: { hasVar: { player: _ctx.self, key: '青囊/usedThisTurn' } } },
        then: [
          {
            type: 'prompt',
            text: '青囊：选择要弃置的手牌和目标角色',
            options: [
              { type: 'selectCard', from: 'hand', min: 1, max: 1 },
              { type: 'selectPlayer' },
            ],
          },
          {
            type: 'atoms',
            ops: [
              { type: 'setVar', player: _ctx.self, key: '青囊/usedThisTurn', value: true },
            ],
          },
        ],
      },
    ];
  },
} satisfies SkillDef);

// ==================== 张角 ====================

registerSkill({
  id: '雷击',
  name: '雷击',
  description: '当你使用或打出【闪】时，可令任意一名角色判定，若结果为黑桃，你对该角色造成2点雷电伤害。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
    optional: true,
  },
  handler(ctx, state): SkillPhase[] {
    if (!ctx.sourceCard) return [];
    const card = state.cardMap[ctx.sourceCard];
    if (!card || card.name !== '闪') return [];

    return [
      {
        type: 'prompt' as const,
        text: '雷击：选择判定的目标角色',
        options: [{ type: 'selectPlayer' as const }],
      },
      { type: 'atoms' as const, ops: [{ type: 'judge', player: ctx.self }] },
      {
        type: 'condition' as const,
        check: { equals: [{ $: 'ctx', path: 'localVars.judgeSuit' }, '♠'] },
        then: [
          {
            type: 'atoms' as const,
            ops: [
              { type: 'damage', target: ctx.target ?? ctx.self, amount: 2, source: ctx.self },
            ],
          },
        ],
      },
    ];
  },
} satisfies SkillDef);

registerSkill({
  id: '鬼道',
  name: '鬼道',
  description: '当一名角色的判定牌生效前，你可以用一张黑色牌替换之。',
  trigger: {
    event: 'judgeResult',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
} satisfies SkillDef);

registerSkill({
  id: '黄天',
  name: '黄天',
  description: '主公技，其他群势力角色可以在其出牌阶段将一张【闪】或【闪电】交给你。',
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
} satisfies SkillDef);

// ==================== 于吉 ====================

registerSkill({
  id: '蛊惑',
  name: '蛊惑',
  description: '你可以扣置一张手牌当作任意一张牌使用或打出。其他角色可质疑并翻开此牌，若为假则双方各受牵连，若为真则质疑者扣减体力。',
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
} satisfies SkillDef);

// ==================== 袁绍 ====================

registerSkill({
  id: '乱击',
  name: '乱击',
  description: '你可以将两张同花色手牌当【万箭齐发】使用。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(ctx, state) {
    const self = getPlayer(state, ctx.self);
    if (self.hand.length < 2) return [];

    type SuitGroup = Record<string, string[]>;
    const groups: SuitGroup = {};
    for (const cardId of self.hand) {
      const card = state.cardMap[cardId];
      if (!card) continue;
      const suit = card.suit;
      if (!groups[suit]) groups[suit] = [];
      groups[suit].push(cardId);
    }

    const hasPair = Object.values(groups).some(g => g.length >= 2);
    if (!hasPair) return [];

    return [
      {
        type: 'prompt' as const,
        text: '乱击：选择两张同花色手牌当【万箭齐发】',
        options: [{ type: 'selectCards' as const, from: 'hand', min: 2, max: 2 }],
      },
    ];
  },
} satisfies SkillDef);

// ==================== 庞德 ====================

registerSkill({
  id: '鞬出',
  name: '鞬出',
  description: '当你使用【杀】指定一名角色为目标后，你可以弃置其一张牌，若弃置的牌为装备牌，其不能使用【闪】；若不为装备牌，其获得此【杀】。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
    optional: true,
  },
  handler(ctx, state) {
    if (!ctx.sourceCard) return [];
    const card = state.cardMap[ctx.sourceCard];
    if (!card || card.name !== '杀') return [];
    if (!ctx.target) return [];

    const target = getPlayer(state, ctx.target);
    if (target.hand.length === 0 && !target.equipment.weapon && !target.equipment.armor &&
        !target.equipment.horsePlus && !target.equipment.horseMinus) {
      return [];
    }

    return [
      {
        type: 'prompt' as const,
        text: `鞬出：弃置 ${ctx.target} 的一张牌`,
        options: [{ type: 'selectPlayer' as const }],
      },
      {
        type: 'condition' as const,
        check: { hasValue: ctx.target },
        then: [
          {
            type: 'atoms' as const,
            ops: [
              { type: 'addTag', player: ctx.target!, tag: 'cannotDodge' },
            ],
          },
        ],
      },
    ];
  },
} satisfies SkillDef);

// ==================== 颜良文丑 ====================

registerSkill({
  id: '双雄',
  name: '双雄',
  description: '摸牌阶段，你可以放弃摸牌，改为展示牌堆顶两张牌并选择其中一张，然后本回合你可以将一张与此牌同花色的手牌当【决斗】使用。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '摸牌',
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
} satisfies SkillDef);

// ==================== 董卓 ====================

registerSkill({
  id: '酒池',
  name: '酒池',
  description: '你可以将一张黑桃手牌当【酒】使用。',
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
} satisfies SkillDef);

registerSkill({
  id: '肉林',
  name: '肉林',
  description: '锁定技，你对女性角色/女性角色对你使用【杀】时，需连续使用两张【闪】才能抵消。',
  trigger: {
    event: 'killHit',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
} satisfies SkillDef);

registerSkill({
  id: '崩坏',
  name: '崩坏',
  description: '锁定技，回合结束阶段，若你的体力不是全场最少的（或同时为最少），你须减1点体力或1点体力上限。',
  trigger: {
    event: 'turnEnd',
    source: 'character',
  },
  handler(ctx, state) {
    const self = getPlayer(state, ctx.self);
    const aliveNames = getAlivePlayerNames(state);
    const minHealth = Math.min(...aliveNames.map(n => getPlayer(state, n).health));

    if (self.health <= minHealth) return [];

    return [
      {
        type: 'prompt' as const,
        text: '崩坏：减1点体力或减1点体力上限',
        options: [
          { label: '减1点体力', value: 'health' },
          { label: '减1点体力上限', value: 'maxHealth' },
        ],
      },
    ];
  },
} satisfies SkillDef);

registerSkill({
  id: '暴虐',
  name: '暴虐',
  description: '主公技，其他群雄角色每造成一次伤害，可进行一次判定，若结果为黑桃，你回复1点体力。',
  trigger: {
    event: 'damageDealt',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
} satisfies SkillDef);

registerSkill({
  id: '乱武',
  name: '乱武',
  description: '限定技，出牌阶段，你可以令所有其他角色依次对与其距离最近的另一名角色使用一张【杀】，无法如此做者失去1点体力。',
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
} satisfies SkillDef);

// ==================== 左慈 ====================

registerSkill({
  id: '化身',
  name: '化身',
  description: '游戏开始时，你随机获得两张未登场的武将牌作为化身牌，然后亮出其中一张，你获得该化身牌上的一个技能。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
} satisfies SkillDef);

registerSkill({
  id: '新生',
  name: '新生',
  description: '每当你受到1点伤害后，你可以获得一张新的化身牌。',
  trigger: {
    event: 'damageReceived',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
} satisfies SkillDef);

// ==================== 蔡文姬 ====================

registerSkill({
  id: '悲歌',
  name: '悲歌',
  description: '当一名角色受到【杀】造成的伤害后，你可以弃置一张牌，然后令该角色判定，根据判定结果执行效果。',
  trigger: {
    event: 'damageReceived',
    source: 'character',
    optional: true,
  },
  handler(ctx, state): SkillPhase[] {
    const self = getPlayer(state, ctx.self);
    if (self.hand.length === 0) return [];

    return [
      {
        type: 'prompt' as const,
        text: '悲歌：弃置一张牌进行判定',
        options: [{ type: 'selectCard' as const, from: 'hand', min: 1, max: 1 }],
      },
      { type: 'atoms' as const, ops: [{ type: 'judge', player: ctx.target ?? ctx.self }] },
      {
        type: 'condition' as const,
        check: { equals: [{ $: 'ctx', path: 'localVars.judgeSuit' }, '♥'] },
        then: [
          { type: 'atoms' as const, ops: [{ type: 'heal', target: ctx.target ?? ctx.self, amount: 1 }] },
        ],
        else: [
          {
            type: 'condition' as const,
            check: { equals: [{ $: 'ctx', path: 'localVars.judgeSuit' }, '♦'] },
            then: [
              { type: 'atoms' as const, ops: [{ type: 'draw', player: ctx.target ?? ctx.self, count: 2 }] },
            ],
          },
        ],
      },
    ];
  },
} satisfies SkillDef);

registerSkill({
  id: '断肠',
  name: '断肠',
  description: '锁定技，杀死你的角色立即失去所有技能直到游戏结束。',
  trigger: {
    event: 'death',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
} satisfies SkillDef);
