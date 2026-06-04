import type { SkillDef } from '../types';
import { registerSkill } from '../skill';
import { getPlayer } from '../state';

// ==================== 孙权 ====================

registerSkill({
  id: '制衡',
  name: '制衡',
  description: '出牌阶段，你可以弃置任意数量的牌，然后摸等量的牌。',
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
        text: '制衡：选择要弃置的牌',
        options: [
          { type: 'selectCards', from: 'hand', min: 1, max: 99 },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'discard', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice.cardIds' } },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'draw', player: _ctx.self, count: { $: 'count', source: { $: 'ctx', path: 'choice.cardIds' } } },
        ],
      },
    ];
  },
});

registerSkill({
  id: '救援',
  name: '救援',
  description: '锁定技，其他吴势力角色对你使用【桃】时，你额外回复1点体力。',
  trigger: {
    event: 'heal',
    source: 'character',
  },
  handler(_ctx, _state) {
    const source = _ctx.source;
    if (!source || source === _ctx.self) return [];
    if (_ctx.target !== _ctx.self) return [];
    const sourcePlayer = _state.players[source];
    if (!sourcePlayer?.info?.faction || sourcePlayer.info.faction !== '吴') return [];
    return [
      { type: 'atoms', ops: [{ type: 'heal', target: _ctx.self, amount: 1 }] },
    ];
  },
});

// ==================== 甘宁 ====================

registerSkill({
  id: '奇袭',
  name: '奇袭',
  description: '你可以将一张黑色手牌当【过河拆桥】使用。',
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
        text: '奇袭：选择一张黑色手牌和目标角色',
        options: [
          { type: 'selectCards', from: 'hand', min: 1, max: 1 },
          { type: 'selectPlayer' },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'discard', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'discardRandom', player: { $: 'ctx', path: 'choice.player' } as const, count: 1, from: 'hand' as const },
        ],
      },
    ];
  },
});

// ==================== 吕蒙 ====================

registerSkill({
  id: '克己',
  name: '克己',
  description: '锁定技，若你未于出牌阶段内使用过【杀】，则你跳过弃牌阶段。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '弃牌',
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'condition',
        check: { not: { hasVar: { player: _ctx.self, key: '杀/usedThisTurn' } } },
        then: [
          {
            type: 'atoms',
            ops: [
              { type: 'setPhase', phase: '结束' },
            ],
          },
        ],
      },
    ];
  },
});

// ==================== 黄盖 ====================

registerSkill({
  id: '苦肉',
  name: '苦肉',
  description: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
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
        type: 'atoms',
        ops: [
          { type: 'damage', target: _ctx.self, amount: 1 },
        ],
      },
      { type: 'checkDying', player: _ctx.self },
      {
        type: 'atoms',
        ops: [
          { type: 'draw', player: _ctx.self, count: 2 },
        ],
      },
    ];
  },
});

// ==================== 周瑜 ====================

registerSkill({
  id: '英姿',
  name: '英姿',
  description: '锁定技，摸牌阶段，你额外摸一张牌。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '摸牌',
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
});

registerSkill({
  id: '反间',
  name: '反间',
  description: '出牌阶段，你可以令一名其他角色选择一种花色，然后展示你的一张手牌：若此牌花色与其所选不同，其受到1点伤害。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    const player = getPlayer(_state, _ctx.self);
    const firstCard = player.hand.length > 0 ? _state.cardMap[player.hand[0]] : null;
    if (!firstCard) return [];

    return [
      {
        type: 'prompt',
        text: '反间：选择目标角色',
        options: [
          { type: 'selectPlayer' },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'setCtxVar', key: 'target', value: { $: 'ctx', path: 'choice.player' } as const },
        ],
      },
      {
        type: 'prompt',
        text: '反间：请选择一种花色',
        options: [
          { label: '♠', value: '♠' },
          { label: '♥', value: '♥' },
          { label: '♣', value: '♣' },
          { label: '♦', value: '♦' },
        ],
      },
      {
        type: 'condition',
        check: { notEquals: [{ $: 'ctx', path: 'choice' } as const, firstCard.suit] },
        then: [
          {
            type: 'atoms',
            ops: [
              { type: 'damage', target: { $: 'ctx', path: 'localVars.target' } as const, amount: 1 },
            ],
          },
        ],
      },
    ];
  },
});

// ==================== 大乔 ====================

registerSkill({
  id: '国色',
  name: '国色',
  description: '你可以将一张♦牌当【乐不思蜀】使用。',
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
        text: '国色：选择一张♦手牌和目标角色',
        options: [
          { type: 'selectCards', from: 'hand', min: 1, max: 1 },
          { type: 'selectPlayer' },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'discard', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const },
        ],
      },
      {
        type: 'atoms',
        ops: [
          {
            type: 'addPendingTrick',
            player: { $: 'ctx', path: 'choice.player' } as const,
            trick: { name: '乐不思蜀', source: _ctx.self, card: { id: '', name: '乐不思蜀', type: '锦囊牌', subtype: '锦囊', suit: '♦', rank: 'A', description: '' } },
          },
        ],
      },
    ];
  },
});

registerSkill({
  id: '流离',
  name: '流离',
  description: '当你成为【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的一名其他角色。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 陆逊 ====================

registerSkill({
  id: '谦逊',
  name: '谦逊',
  description: '锁定技，你不能成为【过河拆桥】和【顺手牵羊】的目标。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: '连营',
  name: '连营',
  description: '当你失去最后的手牌时，你可以摸一张牌。',
  trigger: {
    event: 'cardDiscarded',
    source: 'character',
    optional: true,
    filter: { handEmpty: { $: 'ctx', path: 'self' } },
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
});

// ==================== 孙尚香 ====================

registerSkill({
  id: '结姻',
  name: '结姻',
  description: '出牌阶段，你可以弃置两张手牌，令一名已受伤的男性角色回复1点体力。',
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
        text: '结姻：选择要弃置的两张手牌和目标角色',
        options: [
          { type: 'selectCards', from: 'hand', min: 2, max: 2 },
          { type: 'selectPlayer' },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'discard', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'heal', target: { $: 'ctx', path: 'choice.player' } as const, amount: 1 },
        ],
      },
    ];
  },
});

registerSkill({
  id: '枭姬',
  name: '枭姬',
  description: '当你失去一张装备区里的牌时，你可以摸一张牌。',
  trigger: {
    event: 'equipChanged',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
} satisfies SkillDef);

// ==================== 小乔 ====================

registerSkill({
  id: '红颜',
  name: '红颜',
  description: '锁定技，你的黑桃牌均视为红桃牌。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'addTag', player: _ctx.self, tag: 'spadeToHeart' }] },
    ];
  },
});

registerSkill({
  id: '天香',
  name: '天香',
  description: '当你受到伤害时，你可以弃置一张红桃手牌转移此伤害给任意一名其他角色，然后该角色摸X张牌（X为其已损失体力值）。',
  trigger: {
    event: 'damageReceived',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 周泰 ====================

registerSkill({
  id: '不屈',
  name: '不屈',
  description: '锁定技，当你处于濒死状态时，你可以将牌堆顶一张牌作为"创"牌置于武将牌上，若此牌点数与已有的"创"牌均不同，你回复至1体力；否则死亡。',
  trigger: {
    event: 'damageReceived',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 太史慈 ====================

registerSkill({
  id: '天义',
  name: '天义',
  description: '出牌阶段，你可以与一名角色拼点，若你赢，本回合你攻击范围无限、可额外使用一张【杀】、使用【杀】时可额外指定一个目标；若你没赢，你不能使用【杀】直到回合结束。',
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

// ==================== 鲁肃 ====================

registerSkill({
  id: '好施',
  name: '好施',
  description: '摸牌阶段，你可以额外摸两张牌，若此时你的手牌数超过五张，你必须将一半（向下取整）的手牌交给除你外手牌数最少的一名角色。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '摸牌',
  },
  handler(_ctx, _state) {
    const player = getPlayer(_state, _ctx.self);
    const phases: import('../types').SkillPhase[] = [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 2 }] },
    ];

    if (player.hand.length + 2 > 5) {
      const others = _state.playerOrder.filter(
        n => n !== _ctx.self && _state.players[n].info.alive,
      );
      if (others.length > 0) {
        const minHand = Math.min(...others.map(n => _state.players[n].hand.length));
        const minPlayers = others.filter(n => _state.players[n].hand.length === minHand);
        const target = minPlayers[0];
        const giveCount = Math.floor((player.hand.length + 2) / 2);
        phases.push({
          type: 'prompt',
          text: `好施：将 ${giveCount} 张手牌交给 ${target}`,
          options: [
            { type: 'selectCards', from: 'hand', min: giveCount, max: giveCount },
          ],
        });
        phases.push({
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
                to: { zone: 'hand', player: target },
              }],
            },
          ],
        });
      }
    }

    return phases;
  },
});

registerSkill({
  id: '缔盟',
  name: '缔盟',
  description: '出牌阶段，你可以选择两名其他角色，弃置等同于这两名角色手牌数差的牌，然后交换他们的手牌。',
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

// ==================== 孙坚 ====================

registerSkill({
  id: '英魂',
  name: '英魂',
  description: '回合开始阶段，若你已受伤，可令一名其他角色选择一项：1.摸X张牌再弃一张牌；2.摸一张牌再弃X张牌（X为你已损失体力值）。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '准备',
    optional: true,
  },
  handler(_ctx, _state) {
    const player = getPlayer(_state, _ctx.self);
    const x = player.maxHealth - player.health;
    if (x <= 0) return [];

    return [
      {
        type: 'prompt',
        text: `英魂：选择一名其他角色执行英魂效果（X=${x}）`,
        options: [
          { type: 'selectPlayer' },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'setCtxVar', key: 'target', value: { $: 'ctx', path: 'choice.player' } as const },
        ],
      },
      {
        type: 'prompt',
        text: `英魂：请选择执行项（X=${x}）`,
        options: [
          { label: `摸${x}张牌，弃1张牌`, value: 'option1' },
          { label: `摸1张牌，弃${x}张牌`, value: 'option2' },
        ],
      },
      {
        type: 'condition',
        check: { equals: [{ $: 'ctx', path: 'choice' }, 'option1'] },
        then: [
          { type: 'atoms', ops: [{ type: 'draw', player: { $: 'ctx', path: 'localVars.target' } as const, count: x }] },
          {
            type: 'prompt',
            text: '英魂：请弃置1张牌',
            options: [
              { type: 'selectCards', from: 'hand', min: 1, max: 1 },
            ],
          },
          {
            type: 'atoms',
            ops: [{ type: 'discard', player: { $: 'ctx', path: 'localVars.target' } as const, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const }],
          },
        ],
        else: [
          { type: 'atoms', ops: [{ type: 'draw', player: { $: 'ctx', path: 'localVars.target' } as const, count: 1 }] },
          {
            type: 'prompt',
            text: `英魂：请弃置${x}张牌`,
            options: [
              { type: 'selectCards', from: 'hand', min: x, max: x },
            ],
          },
          {
            type: 'atoms',
            ops: [{ type: 'discard', player: { $: 'ctx', path: 'localVars.target' } as const, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const }],
          },
        ],
      },
    ];
  },
});

// ==================== 孙策 ====================

registerSkill({
  id: '激昂',
  name: '激昂',
  description: '每当你使用（指定目标后）或被使用（成为目标后）一张【决斗】或红色的【杀】时，你可以摸一张牌。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    if (!_ctx.sourceCard) return [];
    const card = _state.cardMap[_ctx.sourceCard];
    if (!card) return [];

    const isDuel = card.name === '决斗';
    const isRedKill = card.name === '杀' && (card.suit === '♥' || card.suit === '♦');

    if (!isDuel && !isRedKill) return [];

    const event = _ctx.event;
    const isUser = event && 'player' in event && _ctx.self === event.player;
    const isTarget = _ctx.target === _ctx.self;

    if (!isUser && !isTarget) return [];

    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
});

registerSkill({
  id: '魂姿',
  name: '魂姿',
  description: '觉醒技，回合开始阶段，若你的体力为1，你须减1点体力上限，并永久获得技能"英姿"和"英魂"。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '准备',
  },
  handler(_ctx, _state) {
    const p = _state.players[_ctx.self];
    if (p.vars['魂姿/awakened']) return [];
    if (p.health !== 1) return [];

    return [
      { type: 'atoms', ops: [{ type: 'setVar', player: _ctx.self, key: '魂姿/awakened', value: true }] },
      { type: 'atoms', ops: [{ type: 'modifyMaxHealth', player: _ctx.self, delta: -1 }] },
      { type: 'atoms', ops: [{ type: 'addSkill', player: _ctx.self, skillId: '英姿' }] },
      { type: 'atoms', ops: [{ type: 'addSkill', player: _ctx.self, skillId: '英魂' }] },
    ];
  },
});

registerSkill({
  id: '制霸',
  name: '制霸',
  description: '主公技，其他吴势力角色的出牌阶段，可与你进行一次拼点。',
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

// ==================== 张昭张纮 ====================

registerSkill({
  id: '直谏',
  name: '直谏',
  description: '出牌阶段，你可以将手牌中的一张装备牌置于一名其他角色的装备区（不得替换原装备），然后摸一张牌。',
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
        text: '直谏：选择一张装备牌和目标角色',
        options: [
          { type: 'selectCards', from: 'hand', min: 1, max: 1 },
          { type: 'selectPlayer' },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'equip', player: { $: 'ctx', path: 'choice.player' } as const, cardId: { $: 'ctx', path: 'choice.cardIds.0' } as const },
        ],
      },
      {
        type: 'atoms',
        ops: [
          { type: 'draw', player: _ctx.self, count: 1 },
        ],
      },
    ];
  },
});

registerSkill({
  id: '固政',
  name: '固政',
  description: '其他角色的弃牌阶段结束时，你可以将弃牌堆中一张该角色弃置的牌返回其手牌，然后获得其余弃牌。',
  trigger: {
    event: 'phaseEnd',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
});
