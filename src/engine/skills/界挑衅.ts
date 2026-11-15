// 挑衅(界姜维·主动技,OL 界限突破官方逐字):
//   出牌阶段限一次,你可以选择一名攻击范围内包含我的角色,然后除非其对你使用一张
//   【杀】且此【杀】对你造成伤害,否则你弃置其一张牌,然后本阶段本技能限两次。
//
// 界限突破(相对标挑衅 src/engine/skills/挑衅.ts):
//   1. 标挑衅:每回合限一次;"出杀 OR 弃牌"(目标出杀即免于被弃,即使被闪抵消)。
//   2. 界挑衅:每阶段限两次;"出杀 + 此杀造成伤害"二者皆满足才免于被弃;
//      否则仍弃其一张牌。即目标出杀但被闪/防具/技能抵消未造成伤害,姜维依然弃其一张牌。
//
// use/respond 全流程、选牌面板(共享 runPickTargetCardPanel,与标版同款;界版旧手写
// pickTargetCard 面板已同步迁移)、onMount 复用标版挑衅导出的 createTiaoxinSkill 工厂;
// 差异经 opts 注入:
//   - 计数限两次:player.vars['界挑衅/usedThisTurn'] 存数字(1/2),沿用 /usedThisTurn
//     后缀由「回合结束」atom 自动清空。每次发动 +1,通过「回合用量」atom 同步 view.turnUsage。
//   - 伤害判定(requireDamage):捕获姜维 hp 快照,跑完整杀结算(出杀→询问闪→造成伤害),
//     结算后比较 hp;hp 未减 → 触发弃牌分支(出杀但未造成伤害也算)。
//   - 契约 key 与标挑衅完全隔离(界挑衅/出杀、界挑衅/选牌、界挑衅/弃牌目标、
//     界挑衅/usedThisTurn),与标挑衅同场共存无冲突;选牌结果键用面板共享 '选牌/结果'。
//
// 命名:文件名/loader key/character skill name 均为 '界挑衅'(避开标挑衅冲突);
//   内部 Skill.name = '挑衅'(OL 官方技能名,玩家可见)。
import type { GameState } from '../types';
import { createTiaoxinSkill, type TiaoxinOptions } from './挑衅';
import { defaultPlayActive } from '../rules/action-active';
import { setPlayerVarUsage } from '../rules/turn-usage';

const SKILL_ID = '界挑衅';
/** 数字计数(1/2);沿用 /usedThisTurn 后缀由「回合结束」atom 自动清空。 */
const COUNT_KEY = `${SKILL_ID}/usedThisTurn`;
const MAX_USES = 2;

/** 本回合已发动次数(0/1/2)。 */
function usesThisTurn(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars[COUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

const OPTIONS: TiaoxinOptions = {
  skillId: SKILL_ID,
  description:
    '出牌阶段限两次:指定一名攻击范围包含你的角色,其须对你出杀且造成伤害,否则你弃其一张牌',
  slashRt: `${SKILL_ID}/出杀`,
  slashChoiceKey: `${SKILL_ID}/出杀选择`,
  pickRt: `${SKILL_ID}/选牌`,
  discardTargetKey: `${SKILL_ID}/弃牌目标`,
  slashPromptTitle: (targetName) =>
    `挑衅:对 ${targetName} 使用一张杀(需造成伤害,否则其弃你一张牌)`,
  limitError: (state, ownerId) =>
    usesThisTurn(state, ownerId) >= MAX_USES ? '本阶段挑衅已达上限(2次)' : null,
  // 计数 +1(setPlayerVarUsage 同步设 vars + 回合用量 atom 投影 view,防 dispatch 重入)
  markUse: async (state, ownerId) => {
    await setPlayerVarUsage(state, ownerId, COUNT_KEY, usesThisTurn(state, ownerId) + 1);
  },
  requireDamage: true,
  useTitle: '挑衅:选择一名攻击范围包含你的角色',
  useDescription: '其须对你出杀且造成伤害,否则你弃其一张牌(本阶段限两次)',
  activeWhen: (ctx) => {
    if (!defaultPlayActive(ctx)) return false;
    const used = ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[COUNT_KEY];
    return (typeof used === 'number' ? used : 0) < MAX_USES;
  },
};

export const { createSkill, onInit, onMount } = createTiaoxinSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
