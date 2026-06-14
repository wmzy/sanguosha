// src/engine/skills/雌雄双股剑.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   雌雄双股剑(武器,攻击范围 2,♠2):
//     - 你使用【杀】指定**异性角色**为目标后触发
//     - 令该角色选择一项:
//       1) 弃置 1 张手牌
//       2) 令你摸 1 张牌
//
// 关键原子操作:
//   after 钩子(指定目标):
//     若 source===ownerId → (本应判断异性) → 弃置(target.hand[0]) + 摸牌(ownerId, 1)
//
// 已知问题/不完整实现:
//   1. **性别完全未判断**:注释明确写"简化:不对性别做判断",
//      任何 target 都触发,严重违反规则——同性角色之间也会强制弃牌+摸牌。
//      需要在 character 数据中加 gender 字段(目前 CharacterConfig 应该有,需 cross-check)。
//   2. **未限于【杀】**:对所有"指定目标"触发,包括决斗、借刀杀人、过河拆桥等,
//      实际只应该在杀的指定目标时触发。需检查 atom.cardId 的 name === '杀'。
//   3. **缺玩家选择**:规则上目标"选择一项",当前直接同时执行弃牌+摸牌,
//      或者只摸牌(目标无牌时)——剥夺目标选择权,且当有牌时双重生效违反规则。
//   4. **弃牌固定 hand[0]**:目标无法选弃哪张,违反规则的"弃一张手牌"由目标自选。
//   5. **缺无差别触发**:每次"指定目标"都触发,若杀有多个目标(连弩+方天画戟),
//      会对每个目标都触发一次——规则中应该是每张杀只触发一次。
// ============================================================
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '雌雄双股剑', description: '武器:对异性角色出杀后,你摸1张牌,目标弃1张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAfterHook(_skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number };
    if (atom.source !== ownerId) return;
    // 简化:不对性别做判断(需要角色性别数据),总是触发效果
    const target = ctx.state.players[atom.target!];
    if (!target || target.hand.length === 0) {
      // 目标无牌可弃,只摸牌
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      return;
    }
    // 目标弃1张,自己摸1张
    await applyAtom(ctx.state, { type: '弃置', player: atom.target!, cardIds: [target.hand[0]] });
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  });
  return () => {};
}

export default { createSkill, onInit };