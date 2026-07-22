// 界耀武(界华雄·群·锁定技,OL hero/446 官方逐字):
//   锁定技,当你受到伤害时,若造成伤害的牌:为红色,伤害来源摸一张牌;不为红色,你摸一张牌。
//
// 界限突破(相对标耀武 — 标版尚未实现,此为独立界版):
//   标耀武:被红色【杀】造成伤害时,来源回复1点体力或摸一张牌。
//   界耀武:任何伤害都触发(不限杀),按伤害牌颜色分支:红→来源摸1;非红/无牌→华雄摸1。
//
// 实现(被动 after-hook,锁定技 = 自动触发,无需询问):
//   造成伤害 after-hook(target===ownerId, amount>0):
//     1. 读取 atom.cardId(造成伤害的牌):
//        - 红色(♥/♦) → applyAtom(摸牌, player=source, count=1)(来源摸一张)
//        - 非红色 或 无 cardId(如闪电) → applyAtom(摸牌, player=ownerId, count=1)(华雄摸一张)
//     2. source 不存在/已死亡时,无法"来源摸牌",降级为华雄自己摸一张(保守行为)
//
// 关键点:
//   - 锁定技:无询问,触发即结算,无"可以"字样即强制(对比标耀武"其选择...或..."非锁定)
//   - "造成伤害的牌":atom.cardId;普通杀/锦囊伤害均有 cardId,部分伤害(闪电/失去体力衍生)
//     无 cardId,按"不为红色"分支处理,华雄摸一张
//   - 颜色判定:card.color === '红'(由花色派生:♥♦→红, ♠♣→黑)
//   - 与势斩共存:势斩创造的虚拟决斗造成的伤害由 loser 受伤,该伤害牌为决斗锦囊(无实体),
//     无 cardId → "不为红色" → 华雄(若为 loser)摸一张;符合规则
//
// 命名:文件名/loader key/character skill name 均为 '界耀武'(避开标耀武冲突);
//   内部 Skill.name = '耀武'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界耀武';
const DISPLAY_NAME = '耀武';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '锁定技,当你受到伤害时,若造成伤害的牌为红色,来源摸一张牌;否则你摸一张牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;

      const damageCardId = atom.cardId;
      const damageCard = damageCardId ? ctx.state.cardMap[damageCardId] : undefined;
      const isRed = !!damageCard && damageCard.color === '红';

      if (isRed) {
        // 红色伤害牌:来源摸一张牌(若来源存活;否则降级为华雄自己摸一张)
        const source = atom.source;
        const sourceAlive =
          typeof source === 'number' && ctx.state.players[source]?.alive;
        await applyAtom(ctx.state, {
          type: '摸牌',
          player: sourceAlive ? source! : ownerId,
          count: 1,
        });
      } else {
        // 非红色或无牌:华雄摸一张牌
        await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 锁定技无主动 UI(无 use/respond action),不需 defineAction
  void api;
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
