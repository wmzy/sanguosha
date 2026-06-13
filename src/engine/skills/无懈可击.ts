// src/engine/skills/无懈可击.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   无懈可击(普通锦囊):在锦囊牌生效前,你可以打出此牌,
//   抵消目标锦囊对一名角色的效果,或抵消另一张【无懈可击】的效果。
//   连环抵消:无懈可击可被另一张无懈可击抵消(无懈套娃)。
//   注意:不能抵消基础牌(杀/闪/桃/酒)和装备牌的效果。
//
// 关键原子操作:
//   respond 路径:
//     移动牌(手牌→弃牌堆) → mutate parent frame.params.__无懈可击生效 = true
//
// 关键时机:
//   - 在锦囊牌生效前(即锦囊 use action 流程中的"询问无懈"环节)
//   - 父帧消费 __无懈可击生效 标志决定是否跳过原锦囊效果
//
// 已知问题/不完整实现:
//   1. **整体不工作:没有询问无懈的 pending 触发**——
//      所有锦囊 use action 文件(南蛮/万箭/决斗/过拆/顺羊/无中/桃园/借刀)
//      都缺少"询问无懈"环节,因此 respond action 永远不会被路由调用,
//      `__无懈可击生效` 永远不会被设。无懈可击实际**完全不生效**。
//   2. **无懈套娃缺失**:即使有询问无懈,本文件没有"对当前 respond 也再次询问无懈"的递归,
//      不支持"用无懈反制无懈"的连环抵消。
//   3. **目标范围缺失**:规则中无懈可指定"任一被锦囊指定的目标"或"另一张无懈",
//      当前 respond 没有 target 参数,无法选择"无懈哪一个目标的效果"
//      (重要:桃园结义/南蛮入侵等是多目标锦囊,无懈应能只取消一个目标)。
//   4. **__无懈可击生效 单 boolean 不区分目标**:多目标锦囊场景下,
//      只标记 "true" 无法表达"无懈了哪个目标",会导致整张锦囊被错误整体取消。
//   5. **缺基础牌/装备牌的过滤校验**:虽然规则上无懈只对锦囊有效,
//      但当前 validate 不检查"父帧是不是锦囊",理论上可在杀帧、桃帧打出无懈(无效操作)。
//   6. validate 仅检查 cardId 类型,不验证手牌持有。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '无懈可击', description: '锦囊:取消一张锦囊牌的效果' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  // 注册 respond action:玩家打出无懈可击
  registerAction(_skill.id, ownerId, 'respond', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const cardId = params.cardId as string;
      // 移无懈可击到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '弃牌堆' } });
      // 在当前帧标记无懈可击生效
      const frame = topFrame(state);
      if (frame) {
        frame.params.__无懈可击生效 = true;
      }
    }, );
  return () => {};
}

export default { createSkill, onInit };
