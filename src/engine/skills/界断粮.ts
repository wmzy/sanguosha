// 界断粮(界徐晃·主动技/转化,OL 现行界版):
//   你可以将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用。
//   若你本回合未造成过伤害,你使用【兵粮寸断】无距离限制。
//
// 与标版差异:
//   - 转化范围:同为"黑色基本牌或装备牌"(与标版一致)
//   - 距离放松:标版为"目标手牌数≥自己则无距离限制";
//     界版改为"本回合未造成过伤害则无距离限制"(OL 现行界版规则)
//
// 转化/校验/execute/onMount 复用标版断粮导出的 createDuanliangSkill 工厂,
// 本文件只写差异:距离放松判据(引擎侧 + view 侧同源)与本回合伤害追踪 hook。
//
// 本回合伤害追踪(界版核心差异):
//   - 造成伤害 after-hook:source=ownerId 且 amount>0 → turn.vars[DMG_VAR]=true
//   - 同步经「回合用量」atom 投影到 view.players[ownerId].turnUsage,供前端 targetFilter 读取
//   - 由「回合结束」atom 自动清空 turn.vars / view.turnUsage,天然每回合重置
import { setTurnVarUsage } from '../rules/turn-usage';
import { registerAfterHook } from '../core/skill';
import { createDuanliangSkill, type DuanliangOptions } from './断粮';

/** turn.vars key:owner 本回合是否造成过伤害(true=已造成)。回合结束自动清空。 */
const DMG_VAR = '界断粮/damageDealt';

const OPTIONS: DuanliangOptions = {
  skillId: '界断粮',
  description:
    '将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用;若本回合未造成过伤害,使用时无距离限制',
  mountTitle: '界断粮:将黑色基本牌或装备牌当兵粮寸断使用',
  // 距离放松:本回合未造成过伤害 → 无限制
  rangeRelaxed: (state, _ownerId, _target) => !state.turn.vars[DMG_VAR],
  rangeRelaxedView: (view, me, _t) => !view.players[me]?.turnUsage?.[DMG_VAR],
  extraInit: (state, skillId, ownerId) => {
    // ── 造成伤害 after-hook:owner 本回合造成过伤害 → 标记 ──
    //    amount>0 才算"造成过伤害"(0 伤害=被抵消,不算)。
    //    同时同步到 view 侧 turnUsage,供前端 targetFilter 读取。
    registerAfterHook(state, skillId, ownerId, '造成伤害后', async (ctx) => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      if (ctx.state.turn.vars[DMG_VAR]) return; // 已标记,避免重复投影
      await setTurnVarUsage(ctx.state, ownerId, DMG_VAR, true);
    });
  },
};

export const { createSkill, onInit, onMount } = createDuanliangSkill(OPTIONS);
