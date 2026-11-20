// 界洛神(界甄姬·被动技):准备阶段,你可以进行判定,若结果为黑色,
// 你可以获得此判定牌,并重复此流程。以此法获得的牌本回合不计入手牌上限。
//
// 官方来源(逐字):"准备阶段,你可以判定,若结果为黑色,你获得此牌,
//   然后你可以重复此流程。以此法获得的牌本回合不计入手牌上限。"
//
// 界版相对标版洛神的变化:
//   - 手牌上限豁免:以此法(洛神判定获得)获得的牌,本回合不计入手牌上限。
//     实现方式:每张获得的判定牌 id 记入 turn.vars['界洛神/豁免牌'](随「回合结束」atom
//     自动随 turn.vars 清空,天然"本回合"语义);并注册 hand-limit 覆盖型提供者,
//     在弃牌阶段/弃牌超时统一读取点把仍在手牌中的豁免牌数加进手牌上限。
//
// 判定主循环/respond/onMount 复用标版洛神导出的 createLuoshenSkill 工厂
// (差异仅 名称/描述/询问 requestType/豁免回调;确认键 '洛神/confirmed' 与
//  judgeType '洛神' 两版共享——标/界甄姬只会拥有一版洛神)。
//
// 判定牌时序:消费方 hook 挂在「判定牌生效后」,在 runJudgeFlow 收尾(把判定牌移入弃牌堆)之前跑。
// 因此洛神的 判定牌生效后 hook 读 frameCards(此时判定牌还在处理区);随后 runJudgeFlow 收尾把
// 判定牌移入弃牌堆。洛神主循环在 runJudgeFlow 返回后,从弃牌堆顶读判定牌。
import type { GameState } from '../types';
import type { SkillModule } from '../types';
import { getHealthValue } from '../types';
import { createLuoshenSkill, type LuoshenOptions } from './洛神';
import { registerHandLimitProvider } from '../rules/hand-limit';
import { getHandLimitBonus } from '../rules/vars-keys';

/** turn.vars key:本回合经洛神获得的判定牌 id 列表(随「回合结束」自动清空) */
const EXEMPT_VAR = '界洛神/豁免牌';

/** 读本回合洛神豁免牌列表(可能为空) */
function readExemptList(state: GameState): string[] {
  const v = state.turn.vars[EXEMPT_VAR];
  return Array.isArray(v) ? (v as string[]) : [];
}

const OPTIONS: LuoshenOptions = {
  name: '界洛神',
  description: '准备阶段判定:黑色获得判定牌并重复;以此法获得的牌本回合不计入手牌上限',
  confirmRt: '界洛神/confirm',
  continueRt: '界洛神/continue',
  mountLabel: '界洛神',
  // 记入豁免牌:本回合不计入手牌上限
  onJudgeCardGained: (state, cardId) => {
    const list = readExemptList(state);
    if (!list.includes(cardId)) {
      list.push(cardId);
      state.turn.vars[EXEMPT_VAR] = list;
    }
  },
  // ── 手牌上限豁免:以此法获得的牌本回合不计入手牌上限 ──
  // 覆盖型提供者:返回 默认公式(体力+加成) + 仍在手牌中的豁免牌数。
  // 无豁免牌时返回 undefined,交回默认公式/其他提供者(取最宽松)。
  // 弃牌阶段(回合管理.ts)与弃牌超时(请求回应.ts)统一经 handLimit() 读取,自动生效。
  extraInit: (state, ownerId) =>
    registerHandLimitProvider(state, ownerId, (st, player) => {
      if (player !== ownerId) return undefined;
      const exempt = readExemptList(st);
      if (exempt.length === 0) return undefined;
      const hand = st.players[player]?.hand ?? [];
      const inHand = exempt.filter((id) => hand.includes(id)).length;
      if (inHand === 0) return undefined;
      const bonus = getHandLimitBonus(st.turn.vars, player) ?? 0;
      const health = getHealthValue(st.players[player]);
      return health + bonus + inHand;
    }),
};

export const { createSkill, onInit, onMount } = createLuoshenSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
