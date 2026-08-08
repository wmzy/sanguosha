// 藤甲(防具):锁定技,南蛮入侵/万箭齐发/普通杀对你无效;当你受到火焰伤害时,此伤害+1。
//
// 双 hook 实现:
// ① 检测有效性 before-hook(对应规则"使用结算开始时:检测有效性"):
//    普通杀(name=杀且非火焰/雷电)/南蛮入侵/万箭齐发 → cancel(对该目标无效)。
//    cancel 后 runSettlementPhase 跳过 resolve:不询问闪/杀、不造成伤害、不触发被抵消。
//    (镜像仁王盾:仁王盾 cancel 黑杀;藤甲 cancel 普通杀+AOE)
// ② 受到伤害时 before-hook:火焰伤害 +1(火杀/火攻/火焰传导等)。
//    属性杀(火杀/雷杀)不被①cancel,正常进入伤害流程:火杀 +1,雷杀正常 1 点。
//
// 与仁王盾的区别:仁王盾按颜色(黑杀无效);藤甲按属性(普通杀/AOE 无效)。
// 火杀/雷杀对藤甲有效(属性杀穿透),火杀额外 +1。
import type { HookResult, Skill, GameState } from '../types';
import { registerBeforeHook } from '../core/skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '藤甲',
    description: '锁定技,南蛮入侵/万箭齐发/普通杀对你无效;火焰伤害+1',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 动态校验防具仍在装备区(陷阱8):获得(顺手牵羊)等路径只移除装备槽、不触发
  // 移除技能(仅 弃置/装备替换 触发),陈旧 hook 可能残留。触发前校验 防具 仍是藤甲,
  // 否则不生效(参考丈八蛇矛动态武器校核)。
  const armorIsTengjia = (st: GameState): boolean => {
    const armorId = st.players[ownerId]?.equipment?.['防具'];
    return !!armorId && st.cardMap[armorId]?.name === '藤甲';
  };

  // ① 检测有效性:普通杀/南蛮入侵/万箭齐发对你无效(cancel → 跳过该目标结算)
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '检测有效性',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (!armorIsTengjia(ctx.state)) return;
      const cardId = atom.cardId;
      if (!cardId) return;
      const card = ctx.state.cardMap[cardId];
      if (!card) return;
      // 普通杀 = 非属性杀(damageType 非 火焰/雷电)。火杀/雷杀穿透藤甲。
      const isNormalSlash =
        card.name === '杀' && card.damageType !== '火焰' && card.damageType !== '雷电';
      const isAOE = card.name === '南蛮入侵' || card.name === '万箭齐发';
      if (isNormalSlash || isAOE) {
        return { kind: 'cancel' };
      }
    },
  );

  // ② 受到伤害时:火焰伤害 +1
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '受到伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (!armorIsTengjia(ctx.state)) return;
      if (atom.damageType !== '火焰') return;
      const baseAmount = atom.amount ?? 1;
      return { kind: 'modify', atom: { ...ctx.atom, amount: baseAmount + 1 } as typeof ctx.atom };
    },
  );

  return () => {};
}
