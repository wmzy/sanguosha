// 红颜(小乔·锁定技):你的黑桃牌均视为红桃牌。
//
// 时机:判定牌翻开前(判定 before hook)。当小乔进行判定时,若牌堆顶为黑桃,
//   在判定 atom 翻开牌(toViewEvents/apply)之前将其花色改为红桃。
//   这样:
//     - 判定视图事件展示红桃(玩家可见红颜效果)
//     - 消费技能(闪电/兵粮寸断/乐不思蜀/八卦阵判定)的 after hook 读到红桃
//   before hook 先于 apply 与所有 after hook 运行,故无注册顺序依赖(优于 after hook 改判)。
//
// 已知限制:判定牌花色被永久改为红桃(入弃牌堆后仍记红桃)。判定牌一旦进弃牌堆,
//   其花色在现行机制下不再被任何结算读取,故该副作用无实际影响。
//
// 联动:天香发动条件("弃一张红桃手牌")由天香自身检查玩家是否拥有红颜来判定
//   黑桃手牌是否合法,不依赖本文件。本文件负责判定牌的花色转换。
import type { Card, FrontendAPI, HookResult, Skill } from '../types';
import { registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '红颜',
    description: '锁定技:你的黑桃牌均视为红桃牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: import('../types').GameState): () => void {
  const ownerId = skill.ownerId;

  // 判定 before:小乔判定时,牌堆顶黑桃 → 红桃(在翻开前改花色)
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '判定',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      // 仅小乔自己的判定:判定牌归小乔所有,红颜才生效
      if (atom.player !== ownerId) return;
      const topId = ctx.state.zones.deck[0];
      if (!topId) return;
      const card: Card | undefined = ctx.state.cardMap[topId];
      if (!card) return;
      if (card.suit !== '♠') return;
      // 黑桃视为红桃:改花色 + 颜色(在翻开前生效,确保 toViewEvents 展示红桃)
      card.suit = '♥';
      card.color = '红';
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 锁定技:无主动 action
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
