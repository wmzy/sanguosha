// 界暴虐(界董卓·主公技,OL 界限突破官方逐字):
//   主公技,当其他群势力角色造成1点伤害后,你可以判定,
//   若结果为黑桃,你回复1点体力并获得此判定牌。
//
// 与标版区别:
//   1. 触发条件:"造成1点伤害后"(标版为"造成伤害后")。本实现按字面解读为 amount===1
//      (即仅当该次伤害实例正好为 1 点时触发);2 点及以上伤害实例不触发。
//      [实现差异/边界] 官方详细规则可能按"每点伤害一次"结算,引擎以单 atom 模型
//      无法天然支持,此处采用字面 amount===1 解读。
//   2. 决策权:"你可以判定"(标版为"其可以令你判定")。两者最终都是问董卓是否判定,
//      实现一致。
//   3. 结算效果:黑桃 → 回复1点体力 **并获得此判定牌**(标版仅回复体力)。
//
// 实现复用标版(暴虐.ts 导出的共享逻辑):respond 注册、「造成伤害后」守卫+确认询问。
//   本文件只保留界版差异:CONFIRM_RT 前缀、amount===1 谓词、询问标题、黑桃获得判定牌。
//
// 关键时序(获得判定牌):
//   - 判定 atom 的 def.afterHooks 直接 mutate state.zones.discardPile.push(judgeCard)
//     (不经过 移动牌 atom,故无法用 移动牌 after-hook 拦截)。
//   - 判定 atom 的 toViewEvents.applyView 无条件 discardPileCount += 1
//     (假设判定牌最终入弃牌堆)。
//   - 若在判定 atom 的 runAfterHooks 阶段(即 判定 after-hook 内)直接移动判定牌
//     (处理区→手牌),会导致状态与视图不一致:state 中弃牌堆未增加,但 view 已 +1。
//   - 解决:不在 判定 上挂 after-hook,而是在 造成伤害 after-hook 内 await 判定
//     完成后(此时 def.afterHooks 已执行,判定牌已在 discardPile 末尾,视图一致),
//     再通过 移动牌 atom(弃牌堆→手牌)拿走。移动牌 的 applyView 会同时减 discardPileCount
//     和加 handCount,保持视图一致。
//
// 关键点:
//   - 仅主公董卓可用(identity==='主公');非主公时 hook 注册但不触发
//   - "其他群雄角色":source≠自己 + source.faction==='群'
//   - 系统伤害(source<0,如闪电)不触发
//   - "1点伤害":atom.amount === 1(字面解读)
//   - 黑桃 = ♠
//   - 获得判定牌:在 await applyAtom(判定) 完成后,从 discardPile 末尾拿
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { runJudgeFlow } from '../flows/judge';
import { registerAfterHook } from '../core/skill';
import { askTyrannyJudgeAfterDamage, registerTyrannyConfirmRespond } from './暴虐';

const CONFIRM_RT = '界暴虐/confirm';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '暴虐',
    description:
      '主公技:其他群势力角色造成1点伤害后可判定,黑桃则回复1点体力并获得此判定牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:董卓回应是否发动暴虐判定(标/界共用注册) ──
  registerTyrannyConfirmRespond(state, skill.id, ownerId, CONFIRM_RT);

  // ── 造成伤害 after:其他群雄角色造成 1 点伤害 → 询问 → 判定 → 黑桃则回复+获牌 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
    // 界版限定:造成 **1 点** 伤害后(字面解读)
    const confirmed = await askTyrannyJudgeAfterDamage(
      ctx,
      ownerId,
      CONFIRM_RT,
      (sourceName) =>
        `暴虐:${sourceName} 造成 1 点伤害,是否进行判定?(黑桃回复1点体力并获得判定牌)`,
      ctx.atom.amount === 1,
    );
    if (!confirmed) return;

    const judgeCardId = await runJudgeFlow(ctx.state, ownerId, '暴虐');
    if (!judgeCardId) return;
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 非黑桃不回复/不获得
    if (judgeCard.suit !== '♠') return;

    // 黑桃 → 获得此判定牌(弃牌堆→手牌)+ 回复1点体力。
    // 必须先取判定牌:读 judgeCardId 与 移动牌 之间不得有任何 await,否则若其间触发的
    // 其他技能已把判定牌移出弃牌堆,移动牌 atom 仍会无条件 hand.push 造成卡牌复制。
    // 移动牌 的 applyView 会同时 discardPileCount-1 + handCount+1,保持视图一致。
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: judgeCardId,
      from: { zone: '弃牌堆' },
      to: { zone: '手牌', player: ownerId },
    });

    // 回复1点体力
    await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '暴虐',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动暴虐?(判定,黑桃回复1点体力并获得判定牌)',
      confirmLabel: '判定',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
