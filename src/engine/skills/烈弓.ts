// 烈弓(黄忠·被动技,OL 标版官方逐字):
//   当你于出牌阶段使用【杀】指定目标后,若其手牌数不小于你的体力值
//   或不大于你的攻击范围,你可以令其不能抵消此【杀】。
//
// 发动条件(两分支均基于目标手牌数):
//   分支1: target.hand.length >= owner.health   (目标手牌数 ≥ 自己体力值)
//   分支2: target.hand.length <= owner.attackRange (目标手牌数 ≤ 自己攻击范围)
//   攻击范围取 owner.vars[DISTANCE_ATTACK_RANGE_KEY],默认 1(徒手)。
//
// 实现(与铁骑同构的禁闪横切机制;骨架由 铁骑.ts 的 createLiegongSkill 共享工厂实现):
//   1. 指定目标 after hook(source===ownerId, card 是杀):
//        若上述条件满足 → 询问"是否发动烈弓" → 若发动 → 给目标加标签 '烈弓/禁闪'。
//   2. 询问闪 before hook(source===ownerId 且 target 有 '烈弓/禁闪' 标签):
//        去标签 + cancel(跳过询问闪 → 处理区无闪 → 杀.execute 造成伤害,强制命中)。
//   守卫链/发动询问/respond/禁闪拦截由工厂逐字共享;本文件仅注入条件判定与加标签。
//
// 标签生命周期:阶段1(指定目标)产出,阶段2(询问闪)消费并清除——天然按单次杀结算。
import { getHealthValue } from '../types';
import { applyAtom } from '../core/apply';
import { getDistanceAttackRange } from '../rules/vars-keys';
import { createLiegongSkill, type LiegongOptions } from './铁骑';

const TAG = '烈弓/禁闪';
const CONFIRM = '烈弓/confirmed';

const OPTIONS: LiegongOptions = {
  name: '烈弓',
  description:
    '使用杀指定目标后,若其手牌数不小于你的体力值或不大于你的攻击范围,可令其不能抵消此杀',
  confirmRt: '烈弓/confirm',
  confirmKey: CONFIRM,
  confirmTitle: '是否发动烈弓(令目标不能出闪)?',
  // 弹窗标题与询问文案不同(全角问号,保留原字面量)
  mountTitle: '是否发动烈弓？',
  mismatchError: '当前不是烈弓确认',
  dodgeBlockTag: TAG,
  // 发动条件(官方):目标手牌数 ≥ 自己体力值,或 目标手牌数 ≤ 自己攻击范围;
  // 攻击范围取 owner.vars[DISTANCE_ATTACK_RANGE_KEY],默认 1(徒手)。
  decide: async (_state, self, targetPlayer) => {
    const attackRange = getDistanceAttackRange(self.vars) ?? 1;
    return (
      targetPlayer.hand.length >= getHealthValue(self) || targetPlayer.hand.length <= attackRange
    );
  },
  // 询问发动("你可以令其不能出闪"——可选)确认后加禁闪标签
  onConfirmed: async (state, _self, _targetPlayer, target) => {
    await applyAtom(state, { type: '加标签', player: target, tag: TAG });
  },
};

export const { createSkill, onInit, onMount } = createLiegongSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
