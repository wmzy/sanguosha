// src/engine/skills/八卦阵.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   八卦阵(防具):当你需要使用或打出【闪】时,你可以进行判定,
//   若判定牌为红色(♥/♦),视为你使用/打出了一张【闪】;若为黑色(♠/♣),
//   视为你未使用/打出此【闪】(需要从手牌出闪)。
//
// 关键原子操作:
//   before 钩子(询问闪):
//     若 atom.target===ownerId ∧ 牌堆非空 → 判定(judgeType='八卦阵') →
//     若判定牌为红色 → 加标签('八卦阵/autoDodge')
//
// 关键时机:
//   - 在 询问闪 atom apply 之前先做判定,根据判定结果"加标签"标记后续杀可无视未出闪
//
// 已知问题/不完整实现:
//   1. **致命:加标签 '八卦阵/autoDodge' 杀.ts 不读!**:文件 header 注释自己写
//      "杀.execute 在观察弃牌堆无闪时检查此标记"——但**杀.ts 中实际根本没有
//      任何代码检查 '八卦阵/autoDodge' 标签**!杀.ts 处理"目标未出闪"的方式是
//      settlement.dodged 仍为 false → 走 造成伤害,八卦阵**完全不工作**——
//      目标出闪失败时,即使八卦阵判红,伤害依然会结算。
//      需要:
//        a) 杀.ts 读取 '八卦阵/autoDodge' 标签(目标有此标签时强制 settlement.dodged=true);
//        b) 或者八卦阵直接 drop 询问闪 后的出闪失败流程,自己 mutate settlement;
//        c) 或者扩展协议让"未出闪"路径支持 short-circuit(难度大)。
//   2. **判定时机错**:before hook 在"询问闪"atom 派发时立即介入做判定,
//      但流程是:hook → 判定 → 加标签 → 询问闪 atom apply(让用户选闪) →
//      用户未出闪 → 杀.ts 看 settlement 决定伤害。
//      实际行为是"先做八卦阵判定,然后用户仍需出闪,然后再读 autoDodge 标签"——
//      这本身没逻辑问题,**只要杀.ts 读标签**——但目前它不读,等于白做判定。
//   3. **判定后用户出闪了**:用户出闪(手牌)与八卦阵 autoDodge 不冲突(规则上:
//      判定为红色后视为出闪;若用户主动出手牌闪,效果重叠也无害)——
//      但加标签会消耗一次判定机会。
//   4. **判定失败时(牌堆空)**:early return 后用户继续走正常出闪流程——OK。
//   5. **加标签 tag 命名 '八卦阵/autoDodge'** 混用英文:按项目命名规范应改为
//      '八卦阵/视为闪' 或 '八卦阵/自动闪避'。但因 杀.ts 不读,改不改暂不紧急。
//   6. **加标签 atom 是否支持任意 tag** 需 cross-check types.ts 的 加标签 atom 类型。
//      加标签 通常用于 game tag(横置/连环/锁定等),业务 tag 可能未支持。
//   7. **未实现"判定为黑色时仍出闪" 路径**:正确,红色 autoDodge,黑色继续等用户出闪——OK。
// ============================================================
import type { AtomBeforeContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '八卦阵',
    description: '防具技:当你需要出闪时,判定,若为红色则视为出闪',
  };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerBeforeHook(skill.id, ownerId, '询问闪', async (ctx: AtomBeforeContext) => {
    // 只对自己生效
    if ((ctx.atom as { target?: number }).target !== ownerId) return;
    if (ctx.state.zones.deck.length === 0) return; // 牌堆空,无法判定

    // 使用判定 atom:deck[0] → judgeZone → after 链后自动入弃牌堆
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '八卦阵' });

    // 判定牌现在在 judgeZone 顶部
    const self = ctx.state.players[ownerId];
    if (!self || self.judgeZone.length === 0) return;
    const judgeCardId = self.judgeZone[self.judgeZone.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (judgeCard && (judgeCard.suit === '♥' || judgeCard.suit === '♦')) {
      // 红色:加 autoDodge 标签(实际存为 mark:tag:八卦阵/autoDodge)
      // 杀.execute 在观察弃牌堆无闪时检查此标记
      // (询问闪继续走完 validate/apply,进入 pending;若用户最终未出闪则 autoDodge 生效)
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: '八卦阵/autoDodge' });
    }
    // 黑色:不做事,继续等用户出闪
  });
  return () => {};
}

export default { createSkill, onInit };