import type { SkillDef, SkillPhase } from '../types';
import { registerSkill } from '../skill';

// ==================== 曹操 ====================

registerSkill({
  id: '奸雄',
  name: '奸雄',
  description: '当你受到伤害后，你可以获得对你造成伤害的牌。',
  trigger: {
    event: 'damageReceived',
    source: 'character',
    optional: true,
  },
  handler(ctx, state) {
    // ctx.sourceCard = 造成伤害的牌 ID
    if (!ctx.sourceCard) return [];
    return [
      {
        type: 'atoms',
        ops: [
          {
            type: 'gainCard',
            player: ctx.self,
            cardId: ctx.sourceCard,
            from: { zone: 'discardPile' },
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
    event: 'damageReceived',
    source: 'character',
    optional: true,
  },
  handler(ctx, state) {
    if (!ctx.source) return [];
    return [
      {
        type: 'atoms',
        ops: [
          {
            type: 'discardRandom',
            player: ctx.source,
            count: 1,
            from: 'hand',
          },
        ],
      },
      // TODO: 将弃置的牌移到 ctx.self 手牌（需要从上一步结果获取 cardId）
    ];
  },
});

registerSkill({
  id: '鬼才',
  name: '鬼才',
  description: '当一张判定牌生效前，你可以打出一张手牌代替之。',
  trigger: {
    event: 'judgeResult',
    source: 'character',
    optional: true,
  },
  handler(ctx, state) {
    return [
      {
        type: 'prompt',
        text: '鬼才：是否用手牌替换判定牌？',
        options: [
          { label: '不替换', value: false },
          { type: 'selectCard', from: 'hand', min: 1, max: 1 },
        ],
        defaultChoice: false,
      },
      {
        type: 'condition',
        check: { hasValue: { $: 'ctx', path: 'choice' } },
        then: [
          // TODO: 用选择的手牌替换判定牌（需要 moveCard atom 将手牌移到判定位置）
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
    event: 'damageReceived',
    source: 'character',
    optional: true,
  },
  handler(ctx, state) {
    if (!ctx.source) return [];
    return [
      { type: 'atoms', ops: [{ type: 'judge', player: ctx.self }] },
      // TODO: 判定后检查结果是否为♥，若不是则让 source 选择弃2牌或受1点伤害
      // 这需要条件判定 + prompt 组合，目前 stub
    ];
  },
});

// ==================== 张辽 ====================

registerSkill({
  id: '突袭',
  name: '突袭',
  description: '摸牌阶段，你可以放弃摸牌，改为获得最多两名其他角色的各一张手牌。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '摸牌',
    optional: true,
  },
  handler(ctx, state) {
    return [
      // 跳过正常摸牌
      { type: 'atoms', ops: [{ type: 'setVar', player: ctx.self, key: 'skipDraw', value: true }] },
      // TODO: 选择最多2名其他角色，各抽1张手牌
      // 需要 foreach + prompt 组合
    ];
  },
});

// ==================== 许褚 ====================

registerSkill({
  id: '裸衣',
  name: '裸衣',
  description: '摸牌阶段，你可以少摸一张牌，若如此做，你使用【杀】或【决斗】时，此牌造成的伤害+1。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '摸牌',
    optional: true,
  },
  handler(ctx, state) {
    return [
      {
        type: 'atoms',
        ops: [
          { type: 'setVar', player: ctx.self, key: '裸衣/active', value: true },
          { type: 'setVar', player: ctx.self, key: '裸衣/usedThisTurn', value: true },
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
    event: 'judgeResult',
    source: 'character',
    optional: true,
  },
  handler(ctx, state) {
    // ctx.sourceCard = 判定牌 ID
    if (!ctx.sourceCard) return [];
    return [
      {
        type: 'atoms',
        ops: [
          {
            type: 'gainCard',
            player: ctx.self,
            cardId: ctx.sourceCard,
            from: { zone: 'discardPile' },
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
    event: 'damageReceived',
    source: 'character',
  },
  handler(ctx, state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: ctx.self, count: 2 }] },
      // TODO: 将最多2张牌分配给其他角色（可选）
      // 需要 prompt 选择分配目标
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
    source: 'character',
    manual: true,
    optional: true,
  },
  handler(ctx, state) {
    // 被动转换技能 — 在 validation 层处理黑色手牌→闪的转换
    return [];
  },
});

registerSkill({
  id: '洛神',
  name: '洛神',
  description: '准备阶段，你可以进行判定：若结果为黑色，你获得此牌，且可以重复此流程。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '准备',
  },
  handler(ctx, state) {
    return [
      {
        type: 'loop',
        while: { not: { equals: [1, 0] } }, // 永真循环，靠 break 退出
        body: [
          { type: 'atoms', ops: [{ type: 'judge', player: ctx.self }] },
          // TODO: 检查判定结果颜色
          // 若红色 → break（需要 loop 退出机制）
          // 若黑色 → gainCard，继续循环
          // 当前 loop 的 while 是条件判断，需要用 var 记录判定结果
        ],
      },
    ];
  },
} satisfies SkillDef);
