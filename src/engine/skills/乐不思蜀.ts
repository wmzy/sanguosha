// src/engine/skills/乐不思蜀.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   乐不思蜀(延时类锦囊):出牌阶段,对一名角色使用,将此牌置入其判定区。
//   该角色判定阶段判定:若判定牌不为红桃,则跳过其本回合的出牌阶段。
//   之后将此牌置入弃牌堆。可被【无懈可击】取消。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) → 添加延时锦囊(target, trick='乐不思蜀') →
//     移动牌(处理区→弃牌堆) → popFrame
//   判定阶段(标准流程,本文件未实现):
//     在判定阶段判定 → 若非红桃则 设阶段(跳过出牌) → 移到弃牌堆
//
// 关键时机:
//   - 添加延时锦囊到目标的 pendingTricks 数组
//   - 判定时机:目标的判定阶段(由回合管理阶段链触发)
//
// 已知问题/不完整实现:
//   1. **判定 hook 是空占位实现**:第 32-36 行 registerAfterHook 注册了空函数,
//      只写了注释"实际需要检查判定牌花色,此处用占位逻辑"——
//      **乐不思蜀完全不工作**:目标永远不会被跳过出牌阶段!
//      需实现:在判定 atom after 时,匹配 judgeType==='乐不思蜀',
//      读判定牌(从 state.localVars 或 player.judgeZone)的 suit,
//      若非 '♥' → 触发 '设阶段(回合结束)' 或加 'skipPlayPhase' 标记。
//   2. **判定本身未触发**:回合管理.ts 中"判定阶段自动 skip"(回合管理已知问题 #2),
//      意味着判定阶段被跳过,从未生成判定 atom——
//      即使 hook 实现了,也不会被触发(双重 bug 叠加)。
//   3. **延时锦囊未在判定后移到弃牌堆**:规则要求判定后将此牌置入弃牌堆,
//      本实现的 use 路径直接弃了原牌,但 pendingTrick 持有 card 副本,
//      target.pendingTricks 中的项永久残留——下回合还会再判定一次!
//   4. **添加延时锦囊去重逻辑**:atom 中 "已有同名则不添加"——
//      但规则允许多张同名延时锦囊(如两张乐不思蜀,需两次判定),
//      去重违反规则,且可能导致多张乐被忽略。
//   5. **无懈可击未支持**:同所有锦囊。
//   6. **trickCard fallback 构造不规范**:第 26 行 trickCard ?? { suit: '', type: '锦囊牌' },
//      suit:'' 是非法 suit(必须是 '♠'|'♥'|'♣'|'♦'),会导致判定花色判断时类型错。
//   7. validate 未检查 target.pendingTricks 是否已有乐不思蜀(虽然 atom 内会去重)。
//   8. validate 未检查 target!==from(规则允许对自己用,但需明确)。
// ============================================================
import type { GameState, AtomAfterContext, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '乐不思蜀', description: '延时锦囊:判定红桃则跳过出牌阶段' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as string;
      pushFrame(state, '乐不思蜀', from, { ...params });
      // 移牌到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 添加延时锦囊到目标
      const trickCard = state.cardMap[cardId];
      await applyAtom(state, { type: '添加延时锦囊', player: target, trick: { name: '乐不思蜀', source: from, card: trickCard ?? { id: cardId, name: '乐不思蜀', suit: '', type: '锦囊牌' } } });
      // 移牌到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  // 判定后检查结果:红桃则标记跳过出牌
  registerAfterHook(_skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    // 简化:通过 ctx.params.__乐不思蜀判定 标记
    // 判定 atom 的结果存在 state.localVars 或 frame.params 中
    // 实际需要检查判定牌花色,此处用占位逻辑
  });
  return () => {};
}

export default { createSkill, onInit };
