// 界烈弓(界黄忠·被动技,OL 界限突破官方逐字):
//   你【杀】的攻击范围为此【杀】点数。当你使用【杀】指定目标后,你可以执行以下效果:
//     1. 若其手牌数不大于你,其不能抵消此【杀】。
//     2. 若其体力值不小于你,此【杀】伤害值 +1。
//
// 与原版烈弓(src/engine/skills/烈弓.ts)的差异:
//   - 攻击范围:原版固定武器范围;界版以「max(武器范围, 杀点数)」为出杀范围(由 杀.ts
//     validate 检测本技能持有者并放宽距离)。
//   - 禁闪条件:原版「体力或手牌不小于你」单一条件 → 禁闪;界版拆为效果1「手牌数不大于你」
//     → 不能抵消(禁闪)。
//   - 加伤:界版新增效果2「体力值不小于你」→ 此杀伤害 +1(原版无加伤)。
//
// 实现(骨架由 铁骑.ts 的 createLiegongSkill 共享工厂实现;守卫链/发动询问/respond/
// 禁闪拦截与标版烈弓逐字共享,本文件注入界版条件与附加初始化):
//   1. 攻击范围:杀.ts use.validate 检测 skills.includes('界烈弓') 后,用 max(武器范围, 杀点数)
//      作为有效范围。本技能文件不重复实现距离逻辑(权威在 distance.ts + 杀.ts)。
//   2. 指定目标 after hook(source===ownerId, card 是杀):
//        计算两条件:
//          condBlock = target.hand.length <= self.hand.length   → 效果1(禁闪)
//          condBonus = target.health    >= self.health          → 效果2(加伤)
//        若至少一条件成立 → 询问「是否发动烈弓」(单次发动,统一管理两效果)。
//        发动后按成立的条件给目标加相应标签:
//          '界烈弓/禁闪' → 询问闪 before hook 消费并 cancel。
//          '界烈弓/加伤' → 造成伤害 before hook 消费并 modify(amount+1)。
//   3. 询问闪 before hook:目标有 '界烈弓/禁闪' 标签 → 去标签 + cancel(强制命中)。
//   4. 造成伤害 before hook:目标有 '界烈弓/加伤' 标签 → 去标签 + modify(amount+1)。
//
// 标签生命周期:由 指定目标 after 产出,由对应 before hook 消费清除——天然按单次杀结算,
// 多目标杀时各目标的标签互不干扰(标签挂在目标身上)。
import type { HookResult, SkillModule } from '../types';
import { getHealthValue } from '../types';
import { applyAtom } from '../core/apply';
import { registerBeforeHook } from '../core/skill';
import { registerAttackRangeExemptor, effectiveDistance } from '../rules/distance';
import { getCardValue } from '../flows/rank';
import { createLiegongSkill, type LiegongOptions } from './铁骑';

const TAG_BLOCK = '界烈弓/禁闪';
const TAG_BONUS = '界烈弓/加伤';
const CONFIRM = '界烈弓/confirmed';

const OPTIONS: LiegongOptions = {
  name: '界烈弓',
  description:
    '你的杀攻击范围为此杀点数;指定目标后,若其手牌数不大于你,其不能抵消;若其体力值不小于你,伤害+1',
  confirmRt: '界烈弓/confirm',
  confirmKey: CONFIRM,
  confirmTitle: '是否发动烈弓?',
  mismatchError: '当前不是界烈弓确认',
  dodgeBlockTag: TAG_BLOCK,
  // 条件判定前的先行副作用 + 两条件独立判定:
  // 清除本目标上残留的界烈弓标签:标签本应"单次杀结算",由对应 before-hook 消费,
  // 但 TAG_BONUS 仅在 造成伤害时 消费——若本杀被闪抵消则 造成伤害不触发,标签会残留;
  // TAG_BLOCK 也可能在 成为目标 被取消(空城/帷幕)导致 询问闪 未触发时残留。残留标签会
  // 串扰下一次对该目标的杀(误禁闪/误加伤,即使本次未发动烈弓)。每次指定目标先清空残留。
  decide: async (state, self, targetPlayer, target) => {
    if (targetPlayer.tags.includes(TAG_BLOCK)) {
      await applyAtom(state, { type: '去标签', player: target, tag: TAG_BLOCK });
    }
    if (targetPlayer.tags.includes(TAG_BONUS)) {
      await applyAtom(state, { type: '去标签', player: target, tag: TAG_BONUS });
    }
    const condBlock = targetPlayer.hand.length <= self.hand.length; // 效果1:手牌不大于自己
    const condBonus = getHealthValue(targetPlayer) >= getHealthValue(self); // 效果2:体力值不小于自己
    return condBlock || condBonus;
  },
  // 按成立条件加标签(同一杀对同一目标可同时叠加禁闪+加伤)。
  // 询问窗口期间状态不变(询问只等本座次 confirm 回应),此处重算条件与发动前判定等价。
  onConfirmed: async (state, self, targetPlayer, target) => {
    if (targetPlayer.hand.length <= self.hand.length) {
      await applyAtom(state, { type: '加标签', player: target, tag: TAG_BLOCK });
    }
    if (getHealthValue(targetPlayer) >= getHealthValue(self)) {
      await applyAtom(state, { type: '加标签', player: target, tag: TAG_BONUS });
    }
  },
  extraInit: (state, skillId, ownerId) => {
    // ── 距离豁免器:你【杀】的攻击范围为此【杀】点数 ──────────────────
    //   官方语义:effectiveRange = max(武器范围, 杀点数)。
    //   predicate 自行计算 effectiveDistance 与 点数比较,命中则放行(返回 true)。
    //   通过 distance provider 实现,避免污染 杀.ts/distance.ts。
    const unloadRangeExemptor = registerAttackRangeExemptor(
      state,
      ownerId,
      (st, from, to, cardId) => {
        if (!cardId) return false;
        const card = st.cardMap[cardId];
        if (!card) return false;
        const rank = getCardValue(card);
        if (rank <= 0) return false;
        return effectiveDistance(st, from, to) <= rank;
      },
    );

    // ── 造成伤害 before:目标有加伤标签 → 去标签 + modify(amount+1) ──
    registerBeforeHook(
      state,
      skillId,
      ownerId,
      '造成伤害时',
      async (ctx): Promise<HookResult | void> => {
        const atom = ctx.atom;
        if (atom.source !== ownerId) return;
        if ((atom.amount ?? 0) <= 0) return;
        const targetIdx = atom.target;
        if (targetIdx === undefined) return;
        const cardId = atom.cardId;
        // cardId 非 string(虚拟伤害等)不触发;仅实体杀的伤害才加伤
        if (typeof cardId !== 'string') return;
        const card = ctx.state.cardMap[cardId];
        if (card?.name !== '杀') return;
        const player = ctx.state.players[targetIdx];
        if (!player?.tags.includes(TAG_BONUS)) return;
        await applyAtom(ctx.state, { type: '去标签', player: targetIdx, tag: TAG_BONUS });
        return {
          kind: 'modify',
          atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom,
        };
      },
    );

    return [unloadRangeExemptor];
  },
};

export const { createSkill, onInit, onMount } = createLiegongSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
