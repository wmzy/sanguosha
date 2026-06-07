import type { SkillDef } from '../types';
import { registerSkill } from '../skill';
import { getPlayer } from '../state';
import { getSkillConvertedCards } from '../validate';

// ==================== 曹操 ====================

registerSkill({
  id: '奸雄',
  name: '奸雄',
  description: '当你受到伤害后，你可以获得对你造成伤害的牌。',
  trigger: {
    event: '受到伤害',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    // ctx.sourceCard = 造成伤害的牌 ID
    if (!_ctx.sourceCard) return [];
    return [
      {
        type: 'atoms',
        ops: [
          {
            type: '获得',
            player: _ctx.self,
            cardId: _ctx.sourceCard,
            from: { zone: '弃牌堆' },
          },
        ],
      },
    ];
  },
});

// ==================== 司马懿 ====================

registerSkill({
  id: '反馈',
  name: '反馈',
  description: '当你受到伤害后，你可以获得伤害来源的一张牌。',
  trigger: {
    event: '受到伤害',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    if (!_ctx.source) return [];
    const sourcePlayer = _state.players[_ctx.source];
    if (!sourcePlayer || sourcePlayer.hand.length === 0) return [];
    return [
      {
        type: 'atoms',
        ops: [
          { type: '随机弃置', player: _ctx.source, count: 1, from: '手牌' },
        ],
      },
      {
        type: 'atoms',
        ops: [
          {
            type: '获得',
            player: _ctx.self,
            cardId: { $: 'ctx', path: 'localVars.discardedCardId' },
            from: { zone: '弃牌堆' },
          },
        ],
      },
    ];
  },
});

registerSkill({
  id: '鬼才',
  name: '鬼才',
  description: '当一张判定牌生效前，你可以打出一张手牌代替之。',
  trigger: {
    event: '判定结果',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '鬼才：是否用手牌替换判定牌？',
        options: [
          { label: '不替换', value: false },
          { type: '选择牌', from: '手牌', min: 1, max: 1 },
        ],
        defaultChoice: false,
      },
      {
        type: 'condition',
        check: { notEquals: [{ $: 'ctx', path: 'choice' }, false] },
        then: [
          // 将原判定牌从弃牌堆移回牌堆
          {
            type: 'atoms',
            ops: [{
              type: '移动牌',
              cardId: _ctx.sourceCard!,
              from: { zone: '弃牌堆' },
              to: { zone: '牌堆' },
            }],
          },
          // 将选择的手牌移到弃牌堆作为新的判定结果
          {
            type: 'atoms',
            ops: [{
              type: '移动牌',
              cardId: { $: 'ctx', path: 'choice' },
              from: { zone: '手牌', player: _ctx.self },
              to: { zone: '弃牌堆' },
            }],
          },
        ],
      },
    ];
  },
});

// ==================== 夏侯惇 ====================

registerSkill({
  id: '刚烈',
  name: '刚烈',
  description: '当你受到伤害后，你可以进行判定：若结果不为♥，伤害来源弃置两张手牌或受到1点伤害。',
  trigger: {
    event: '受到伤害',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    if (!_ctx.source) return [];
    return [
      { type: 'atoms', ops: [{ type: '判定', player: _ctx.self }] },
      {
        type: 'condition',
        check: { notEquals: [{ $: 'ctx', path: 'localVars.judgeSuit' }, '♥'] },
        then: [
          { type: 'atoms', ops: [{ type: '造成伤害', target: _ctx.source, amount: 1 }] },
          { type: 'checkDying', player: _ctx.source },
        ],
      },
    ];
  },
});

// ==================== 张辽 ====================

registerSkill({
  id: '突袭',
  name: '突袭',
  description: '摸牌阶段，你可以放弃摸牌，改为获得最多两名其他角色的各一张手牌。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '摸牌',
    optional: true,
  },
  handler(_ctx, _state) {
    const others = _state.playerOrder.filter(
      n => n !== _ctx.self && _state.players[n].info.alive && _state.players[n].hand.length > 0,
    );
    const targets = others.slice(0, 2);
    if (targets.length === 0) return [];

    const phases: import('../types').SkillPhase[] = [
      { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '突袭/跳过摸牌', value: true }] },
    ];

    for (const target of targets) {
      phases.push(
        { type: 'atoms', ops: [{ type: '随机弃置', player: target, count: 1, from: '手牌' }] },
        {
          type: 'atoms',
          ops: [{
            type: '获得',
            player: _ctx.self,
            cardId: { $: 'ctx', path: 'localVars.discardedCardId' },
            from: { zone: '弃牌堆' },
          }],
        },
      );
    }

    return phases;
  },
});

// ==================== 许褚 ====================

registerSkill({
  id: '裸衣',
  name: '裸衣',
  description: '摸牌阶段，你可以少摸一张牌，若如此做，你使用【杀】或【决斗】时，此牌造成的伤害+1。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '摸牌',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '裸衣：是否少摸一张牌，使本回合【杀】/【决斗】伤害+1？',
        options: [
          { label: '不发动', value: false },
          { label: '发动', value: true },
        ],
        defaultChoice: false,
      },
      {
        type: 'condition',
        check: { equals: [{ $: 'ctx', path: 'choice' }, true] },
        then: [
          {
            type: 'atoms',
            ops: [
              { type: '设置变量', player: _ctx.self, key: '裸衣/active', value: true },
              { type: '设置变量', player: _ctx.self, key: '裸衣/usedThisTurn', value: true },
            ],
          },
        ],
      },
    ];
  },
});

// ==================== 郭嘉 ====================

registerSkill({
  id: '天妒',
  name: '天妒',
  description: '当你的判定牌生效后，你可以获得此判定牌。',
  trigger: {
    event: '判定结果',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    // ctx.sourceCard = 判定牌 ID
    if (!_ctx.sourceCard) return [];
    return [
      {
        type: 'atoms',
        ops: [
          {
            type: '获得',
            player: _ctx.self,
            cardId: _ctx.sourceCard,
            from: { zone: '弃牌堆' },
          },
        ],
      },
    ];
  },
});

registerSkill({
  id: '遗计',
  name: '遗计',
  description: '当你受到1点伤害后，你可以摸两张牌。',
  trigger: {
    event: '受到伤害',
    source: '角色',
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 2 }] },
      {
        type: 'prompt',
        text: '遗计：选择最多2张牌分配给其他角色（或不分配）',
        options: [
          { label: '不分配', value: false },
          { type: 'selectCards', from: '手牌', min: 1, max: 2 },
        ],
        defaultChoice: false,
      },
      {
        type: 'condition',
        check: { notEquals: [{ $: 'ctx', path: 'choice' }, false] },
        then: [
          { type: 'atoms', ops: [{ type: '设置上下文变量', key: '遗计/cards', value: { $: 'ctx', path: 'choice' } as const }] },
          { type: 'atoms', ops: [{ type: '弃置', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice' } as const }] },
          {
            type: 'prompt',
            text: '遗计：选择获得牌的目标角色',
            options: [
              { type: 'selectPlayer' },
            ],
          },
          {
            type: 'foreach',
            collection: { $: 'ctx', path: 'localVars.遗计/cards' },
            varName: 'currentCard',
            body: [
              {
                type: 'atoms',
                ops: [{
                  type: '获得',
                  player: { $: 'ctx', path: 'choice' },
                  cardId: { $: 'ctx', path: 'localVars.currentCard' },
                  from: { zone: '弃牌堆' },
                }],
              },
            ],
          },
        ],
      },
    ];
  },
});

// ==================== 甄姬 ====================

registerSkill({
  id: '倾国',
  name: '倾国',
  description: '你可以将一张黑色手牌当【闪】使用或打出。',
  trigger: {
    event: 'killResponse',
    source: '角色',
    manual: true,
    optional: true,
  },
  // 被动转换 — validate 读此字段（替代 validate.ts:111-118 硬编码）。
  // 倾国 = 任意黑色手牌当闪。from: '*' 配合 suit filter 表达。
  convertible: [{
    from: '*',
    to: '闪',
    filter: {
      or: [
        { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♠'] },
        { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♣'] },
      ],
    },
  }],
  handler(_ctx, _state) {
    // 被动转换技能 — 在 validation 层处理黑色手牌→闪的转换
    return [];
  },
});

registerSkill({
  id: '洛神',
  name: '洛神',
  description: '准备阶段，你可以进行判定：若结果为黑色，你获得此牌，且可以重复此流程。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '准备',
  },
  handler(_ctx, _state) {
    return [
      // 预置初始判定结果为黑色，确保首次进入循环
      { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '洛神/judgeResult', value: 'black' }] },
      {
        type: 'loop',
        // 检查上次判定结果：红色则退出循环，黑色继续
        while: { notEquals: [{ $: 'var', player: { $: 'ctx', path: 'self' }, key: '洛神/judgeResult' }, 'red'] },
        body: [
          { type: 'atoms', ops: [{ type: '判定', player: _ctx.self, varKey: '洛神/judgeResult' }] },
          {
            type: 'condition',
            check: { equals: [{ $: 'var', player: { $: 'ctx', path: 'self' }, key: '洛神/judgeResult' }, 'black'] },
            then: [
              {
                type: 'atoms',
                ops: [{
                  type: '获得',
                  player: { $: 'ctx', path: 'self' },
                  cardId: { $: 'ctx', path: 'localVars.judgeCardId' },
                  from: { zone: '弃牌堆' },
                }],
              },
            ],
          },
        ],
      },
    ];
  },
} satisfies SkillDef);

// ==================== 夏侯渊 ====================

registerSkill({
  id: '神速',
  name: '神速',
  description: '你可以选择以下一至两项：1.跳过判定阶段和摸牌阶段；2.跳过出牌阶段并弃置一张装备牌。你每选择一项，视为对一名其他角色使用一张无距离限制的【杀】。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '判定',
    optional: true,
    manual: true,
  },
  handler(_ctx, _state) {
    const target = _ctx.target;
    if (!target) return [];

    const targetPlayer = getPlayer(_state, target);
    if (!targetPlayer.info.alive) return [];

    const literalDodge = targetPlayer.hand.filter(
      (id) => _state.cardMap[id]?.name === '闪',
    );
    const skillDodge = getSkillConvertedCards(_state, target, '闪');
    const validCards = [...new Set([...literalDodge, ...skillDodge])];

    return [
      {
        type: '打出',
        window: {
          type: 'killResponse',
          attacker: _ctx.self,
          defender: target,
          validCards,
        },
      },
    ];
  },
});

// ==================== 曹仁 ====================

registerSkill({
  id: '据守',
  name: '据守',
  description: '结束阶段，你可以翻面并摸三张牌，然后跳过你的下一回合。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '结束',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 3 }] },
      { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '据守/flipped', value: true }] },
    ];
  },
});

// ==================== 荀彧 ====================

registerSkill({
  id: '驱虎',
  name: '驱虎',
  description: '出牌阶段，你可以与一名角色拼点，若你赢，该角色对其攻击范围内另一名角色造成1点伤害；若你没赢，该角色对你造成1点伤害。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '出牌',
    optional: true,
    manual: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '驱虎：选择拼点目标',
        options: [
          { label: '不发动', value: false },
          { type: 'selectPlayer', filter: { handEmpty: _ctx.self } },
        ],
        defaultChoice: false,
      },
    ];
  },
});

registerSkill({
  id: '节命',
  name: '节命',
  description: '当你受到1点伤害后，你可以令一名角色将手牌摸至X张（X为其体力上限且最多为5）。',
  trigger: {
    event: '受到伤害',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const selfPlayer = _state.players[_ctx.self];
    const drawCount = Math.min(selfPlayer.maxHealth, 5) - selfPlayer.hand.length;
    if (drawCount <= 0) return [];
    return [
      { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: Math.min(drawCount, 5) }] },
    ];
  },
});

// ==================== 典韦 ====================

registerSkill({
  id: '强袭',
  name: '强袭',
  description: '出牌阶段，你可以自减1点体力或弃一张武器牌，对攻击范围内的一名角色造成1点伤害。每回合限一次。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '出牌',
    optional: true,
    manual: true,
  },
  handler(_ctx, _state) {
    const selfPlayer = _state.players[_ctx.self];
    if (!selfPlayer || selfPlayer.health <= 0) return [];

    const target = _ctx.target;
    if (!target) return [];

    const ops: import('../types').Atom[] = [
      { type: '造成伤害', target: _ctx.self, amount: 1 },
      { type: '造成伤害', target, amount: 1 },
    ];

    return [
      { type: 'atoms', ops },
      { type: 'checkDying', player: _ctx.self },
      { type: 'checkDying', player: target },
    ];
  },
});

// ==================== 曹丕 ====================

registerSkill({
  id: '行殇',
  name: '行殇',
  description: '你可以立即获得死亡角色的所有牌。',
  trigger: {
    event: '死亡',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const e = _ctx.event as Record<string, unknown> | undefined;
    const deadPlayer = (e?.['player'] as string) ?? _ctx.target;
    if (!deadPlayer) return [];

    const dead = _state.players[deadPlayer];
    if (!dead) return [];

    const phases: import('../types').SkillPhase[] = [];

    for (const cardId of dead.hand) {
      phases.push({
        type: 'atoms',
        ops: [{
          type: '获得',
          player: _ctx.self,
          cardId,
          from: { zone: '弃牌堆' },
        }],
      });
    }

    return phases;
  },
});

registerSkill({
  id: '放逐',
  name: '放逐',
  description: '每当你受到一次伤害后，可以令除你以外的任一角色补X张牌（X为你已损失体力值），然后该角色将其武将牌翻面。',
  trigger: {
    event: '受到伤害',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const selfPlayer = _state.players[_ctx.self];
    if (!selfPlayer) return [];
    const lostHealth = selfPlayer.maxHealth - selfPlayer.health;
    if (lostHealth <= 0) return [];

    return [
      {
        type: 'prompt',
        text: `放逐：令一名角色补${lostHealth}张牌并翻面`,
        options: [
          { label: '不发动', value: false },
          { type: 'selectPlayer' },
        ],
        defaultChoice: false,
      },
    ];
  },
});

registerSkill({
  id: '颂威',
  name: '颂威',
  description: '其他魏势力角色的判定牌结果为黑色且生效后，可以让你摸一张牌。',
  trigger: {
    event: '判定结果',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const e = _ctx.event as Record<string, unknown> | undefined;
    const result = e?.['result'] as string | undefined;
    if (result !== 'black') return [];

    const judgePlayer = e?.['player'] as string | undefined;
    if (!judgePlayer || judgePlayer === _ctx.self) return [];

    const judgePlayerState = _state.players[judgePlayer];
    if (judgePlayerState?.info.faction !== '魏') return [];

    return [
      { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
    ];
  },
});

// ==================== 徐晃 ====================

registerSkill({
  id: '断粮',
  name: '断粮',
  description: '你可以将一张黑色的基本牌或黑色装备牌当【兵粮寸断】使用；你对手牌数不小于你的角色使用【兵粮寸断】无距离限制。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '出牌',
    optional: true,
    manual: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '断粮：选择一张黑色基本牌/装备牌当兵粮寸断使用',
        options: [
          { label: '不发动', value: false },
          { type: '选择牌', from: '手牌', min: 1, max: 1 },
        ],
        defaultChoice: false,
      },
    ];
  },
});

// ==================== 张郃 ====================

registerSkill({
  id: '巧变',
  name: '巧变',
  description: '你可以弃置一张手牌来跳过自己的一个阶段（回合开始和回合结束阶段除外）。若以此法跳过摸牌阶段，你从至多两名其他角色处各获得一张手牌；若以此法跳过出牌阶段，你可以将场上的一张牌移动到另一个合理的位置。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const e = _ctx.event as Record<string, unknown> | undefined;
    const phase = e?.['phase'] as string | undefined;
    if (!phase || phase === '准备' || phase === '结束') return [];

    return [
      {
        type: 'prompt',
        text: `巧变：是否弃一张手牌跳过${phase}阶段？`,
        options: [
          { label: '不发动', value: false },
          { type: '选择牌', from: '手牌', min: 1, max: 1 },
        ],
        defaultChoice: false,
      },
    ];
  },
});

// ==================== 邓艾 ====================

registerSkill({
  id: '屯田',
  name: '屯田',
  description: '每次当你于回合外失去牌时，可进行一次判定，将非红桃的判定牌置于你的武将牌上，称为"田"；每有一张田，你计算与其他角色的距离便减少1。',
  trigger: {
    event: '弃置',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const e = _ctx.event as Record<string, unknown> | undefined;
    // 只在自己失去牌时触发
    if (e?.['player'] !== _ctx.self) return [];
    // 只在回合外触发
    if (_state.currentPlayer === _ctx.self) return [];

    return [
      { type: 'atoms', ops: [{ type: '判定', player: _ctx.self, varKey: '屯田/judgeResult' }] },
      {
        type: 'condition',
        check: { notEquals: [{ $: 'var', player: _ctx.self, key: '屯田/judgeResult' }, '♥'] },
        then: [
          { type: 'atoms', ops: [{ type: '增加变量', player: _ctx.self, key: '屯田/count', delta: 1 }] },
        ],
      },
    ];
  },
});

registerSkill({
  id: '凿险',
  name: '凿险',
  description: '准备阶段，若"田"的数量≥3，你须减1点体力上限，然后获得技能"急袭"（你可以将一张"田"当【顺手牵羊】使用）。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '准备',
  },
  handler(_ctx, _state) {
    const p = _state.players[_ctx.self];
    if (p.vars['凿险/awakened']) return [];
    const count = (p.vars['屯田/count'] as number) ?? 0;
    if (count < 3) return [];

    return [
      { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '凿险/awakened', value: true }] },
      { type: 'atoms', ops: [{ type: '设上限', player: _ctx.self, delta: -1 }] },
    ];
  },
});
