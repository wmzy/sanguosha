import type { SkillDef } from '../types';
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
  handler(ctx, state) {
    return [
      {
        type: 'prompt',
        text: '仁德：选择要送出的手牌和目标角色',
        options: [
          { type: 'selectCard', from: 'hand', min: 1 },
          { type: 'selectPlayer' },
        ],
      },
      // TODO: 将选择的牌移到目标角色手牌
      // TODO: 检查本阶段已给出的牌数，若 >= 2 则 heal 1
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
  handler(ctx, state) {
    // TODO: 复杂多玩家交互，需要 duel 系统支持
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
  handler(ctx, state) {
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
  handler(ctx, state) {
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
  handler(ctx, state) {
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
  handler(ctx, state) {
    // TODO: 需要查看牌堆顶 N 张牌并重新排列的 UI 交互
    return [];
  },
});

registerSkill({
  id: '空城',
  name: '空城',
  description: '锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
  },
  handler(ctx, state) {
    return [];
  },
});

// ==================== 马超 ====================

registerSkill({
  id: '马术',
  name: '马术',
  description: '锁定技，你计算与其他角色的距离时，始终-1。',
  trigger: {
    event: 'turnStart',
    source: 'character',
  },
  handler(ctx, state) {
    return [];
  },
});

registerSkill({
  id: '铁骑',
  name: '铁骑',
  description: '当你使用【杀】指定一名角色为目标后，你可以进行判定：若结果为红色，该角色不能使用【闪】。',
  trigger: {
    event: 'killHit',
    source: 'character',
    optional: true,
  },
  handler(ctx, state) {
    if (!ctx.target) return [];
    return [
      { type: 'atoms', ops: [{ type: 'judge', player: ctx.self }] },
      // TODO: 检查判定结果是否为红色
      // 若红色 → setTag(target, 'cannotDodge')
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
  handler(ctx, state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: ctx.self, count: 1 }] },
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
  handler(ctx, state) {
    return [];
  },
} satisfies SkillDef);
