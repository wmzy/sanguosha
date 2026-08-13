// 界智迟(界陈宫·群·锁定技,OL 界限突破官方逐字):
//   "锁定技,当你于回合外受到伤害后,本回合【杀】和普通锦囊牌对你无效。"
//
// 与标版智迟(docs/research/武将技能/群雄/陈宫.md)对比:**描述完全相同**。
// 标版陈宫未实现,按界武将命名约定(标版未实现时创建"界X"文件),独立文件界智迟.ts。
//
// 触发模型(锁定技):
//   - 触发时机:造成伤害 after-hook,target===owner && currentPlayerIndex!==owner(回合外)
//   - 激活后写 turn.vars[ACTIVE_KEY]=ownerId(回合结束 atom 自动清空 turn.vars,天然每回合重置)
//
// "本回合杀和普通锦囊牌对你无效"实现(registerCardInvalidation 原语统一拦截 7 个点):
//   成为目标/检测有效性/询问杀/受到伤害时/获得/弃置/设横置。
//   谓词:isActiveFor(state,owner) && isAffectingCard(card)(杀或普通锦囊)。
//   cardId 来源(逐 atom):成为目标/检测有效性/受到伤害时 用 atom.cardId;
//   询问杀/获得/弃置/设横置 用 topFrame(state).params.cardId(由原语内部解析)。
//
// 卡类型判定:
//   - 杀:card.name === '杀'(含物理杀与武圣/丈八转化杀——通过 cardMap 影子卡判定)
//   - 普通锦囊:card.type === '锦囊牌' && card.trickSubtype !== '延时锦囊'
//     (延时锦囊如乐不思蜀/兵粮寸断/闪电不属于"普通锦囊",不受智迟影响)
//
// cardId 来源:
//   - 直接:atom.cardId(杀/决斗/火攻 的 造成伤害 atom 直接带 cardId)
//   - 间接:top frame params.cardId(普通锦囊 use execute pushFrame 时携带)
//   两者都不存在时,不视为杀/锦囊(可能是反馈/刚烈等技能造成的伤害,智迟不影响)
//
// 命名:文件名/loader key/character skill name 均为 '界智迟';内部 Skill.name='智迟'(OL 官方名)。
import type { Card, GameState, Skill, SkillModule } from '../types';
import { registerAfterHook } from '../core/skill';
import { registerCardInvalidation } from '../core/card-invalidation';

const _SKILL_ID = '界智迟';
const DISPLAY_NAME = '智迟';

/** turn.vars key:智迟激活(值=激活者 ownerId)。turn.vars 在「回合结束」atom 自动清空。 */
const ACTIVE_KEY = '智迟/active';

/** 判定一张卡是否为【杀】(含转化杀——影子卡 name 即为 '杀') */
function isSlash(card: Card | undefined): boolean {
  return !!card && card.name === '杀';
}

/** 判定一张卡是否为普通锦囊牌(排除延时锦囊与响应锦囊)。
 *  响应锦囊(无懈可击)与延时锦囊(乐不思蜀/兵粮寸断/闪电)均不属于"普通锦囊",
 *  不受智迟影响。与 validateUseCard 的普通锦囊定义一致。
 *  关键:无懈可击走 runUseFlow(effect-target)→runSettlementPhase→检测有效性,
 *  若不排除响应锦囊,智迟激活时 owner 自己打出无懈可击会被自身 检测有效性 hook cancel,
 *  导致 owner 无法使用无懈可击。 */
function isNormalTrick(card: Card | undefined): boolean {
  return (
    !!card &&
    card.type === '锦囊牌' &&
    card.trickSubtype !== '延时锦囊' &&
    card.trickSubtype !== '响应锦囊'
  );
}

/** 判定一张卡是否为智迟影响范围(杀或普通锦囊) */
function isAffectingCard(card: Card | undefined): boolean {
  return isSlash(card) || isNormalTrick(card);
}

/** 智迟是否对本 owner 已激活(本回合) */
function isActiveFor(state: GameState, ownerId: number): boolean {
  return state.turn.vars[ACTIVE_KEY] === ownerId;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '锁定技:回合外受到伤害后,本回合【杀】和普通锦囊牌对你无效',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── 触发:回合外受到伤害后,激活智迟(本回合剩余时间生效)──
  unloaders.push(
    registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      // 回合外 = 不是 owner 自己的回合
      if (ctx.state.currentPlayerIndex === ownerId) return;
      // 已死亡则不激活
      if (!ctx.state.players[ownerId]?.alive) return;
      ctx.state.turn.vars[ACTIVE_KEY] = ownerId;
    }),
  );

  // ── 拦截:本回合杀和普通锦囊对 owner 无效(7 个拦截点统一交给 registerCardInvalidation)──
  //   谓词:智迟已激活 且 当前关联卡为杀/普通锦囊。
  //   cardId 来源(逐 atom):成为目标/检测有效性/受到伤害时 用 atom.cardId;
  //   询问杀/获得/弃置/设横置 用 topFrame(state).params.cardId(由原语内部解析)。
  unloaders.push(
    registerCardInvalidation(state, skill.id, ownerId, (st, card) => {
      if (!isActiveFor(st, ownerId)) return false;
      return isAffectingCard(card);
    }),
  );

  return () => {
    for (const u of unloaders) u();
  };
}

const _skillModule: SkillModule = { createSkill, onInit };
export default _skillModule;
