// src/engine/skills/诸葛连弩.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   诸葛连弩(武器,攻击范围 1,♠A):
//     - 出牌阶段,你可以使用任意数量的【杀】
//     - 移除了每回合只能使用 1 张【杀】的限制
//
// 关键原子操作:
//   after 钩子(设阶段):
//     若 phase==='出牌' ∧ 装备的武器 name==='诸葛连弩' → 加标记('诸葛连弩/无限出杀', duration=turn)
//   消费:杀.ts validate 中检查此 mark,跳过 killsPlayed 限制
//
// 关键时机:
//   - 标记的添加时机:出牌阶段开始
//   - 标记的清理:回合结束(duration='turn')
//
// 已知问题/不完整实现:
//   1. **监听的 atom 类型不匹配实际事件**:hook 监听 '设阶段',
//      但 回合管理.ts 实际派发的是 '阶段开始'/'阶段结束','设阶段' atom 从未被使用!
//      **诸葛连弩完全不工作** — mark 永远不会被添加。
//      应改为监听 '阶段开始' 且 phase==='出牌'。
//   2. **杀.ts 硬编码 mark 名 '诸葛连弩/无限出杀'**:导致诸葛连弩和杀技能强耦合,
//      新增"无限出杀"类武器需要修改杀.ts 添加 OR 条件。
//      应提供通用"出杀次数修正"hook 让武器接入。
//   3. **中途换装备时 mark 残留**:回合开始时装备诸葛连弩 + 加 mark,
//      然后中途换装其他武器,mark 仍在(turn 末才清),本回合仍可无限出杀(虽然武器已换)。
//      应在"卸下" hook 中同步清 mark。
//   4. validate 路径:杀.ts 用 `mark.id === '诸葛连弩/无限出杀'` 检查,
//      若名字微调(typo)会 silent failure,缺单元测试守护。
// ============================================================
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '诸葛连弩', description: '武器:出杀无次数限制' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  // 出牌阶段开始时:添加"诸葛连弩=无限出杀"标记
  registerAfterHook(_skill.id, ownerId, '设阶段', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { phase?: string };
    if (atom.phase !== '出牌') return;
    const me = ctx.state.players[ownerId];
    if (!me) return;
    // 检查是否装备了诸葛连弩
    const weaponId = me.equipment?.['武器'];
    if (!weaponId) return;
    const card = ctx.state.cardMap[weaponId];
    if (card?.name !== '诸葛连弩') return;
    await applyAtom(ctx.state, {
      type: '加标记',
      player: ownerId,
      mark: { id: '诸葛连弩/无限出杀', scope: -1, payload: 1, duration: 'turn' },
    });
  });
  return () => {};
}

export default { createSkill, onInit };
