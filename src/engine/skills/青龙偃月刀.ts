// src/engine/skills/青龙偃月刀.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   青龙偃月刀(武器,攻击范围 3,♠5):
//     - 你使用的【杀】被【闪】抵消后
//     - 你可以对相同目标再使用 1 张【杀】
//     - **可以连续追击直到命中或无杀可用**
//
// 关键原子操作:
//   after 钩子(询问闪):
//     若 source===ownerId ∧ 装备青龙偃月刀 ∧ discardPile 顶为闪
//       → 加标签('青龙偃月刀/可追杀') + 写入 localVars(追杀目标)
//   confirm action(青龙偃月刀/可追杀):
//     validate: 参数 choice 为 boolean 且玩家带 '青龙偃月刀/可追杀' 标签
//     execute: 去标签 + 若 choice=true 则对 localVars 中目标再次 询问闪
//
// 关键时机:
//   - 询问闪 atom after 触发 → 检测是否被闪抵消
//   - 通过 state.zones.discardPile 顶端读最近一张被弃的牌判断是否为闪
//   - 跨 atom 通信通过 state.localVars(target 追杀目标)
import type { AtomAfterContext, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const TAG = '青龙偃月刀/可追杀';
const TARGET_KEY = (ownerId: number): string => `青龙偃月刀:${ownerId}:target`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '青龙偃月刀',
    description: '武器技:杀被闪抵消后,可对相同目标再使用一张杀',
  };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  // ── after hook:检测自己的杀被闪抵消,加标签标记「可追杀」──
  registerAfterHook(_skill.id, ownerId, '询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number };
    // 只对自己使用的杀做出反应
    if (atom.source !== ownerId) return;
    // 检查自己装备的是青龙偃月刀
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const weaponId = self.equipment?.['武器'];
    if (!weaponId) return;
    const weapon = ctx.state.cardMap[weaponId];
    if (!weapon || weapon.name !== '青龙偃月刀') return;
    // 检查最近一张弃牌是否为闪(即目标是否出了闪)
    const discardPile = ctx.state.zones.discardPile;
    if (discardPile.length === 0) return;
    const topCardId = discardPile[discardPile.length - 1];
    const topCard = ctx.state.cardMap[topCardId];
    if (!topCard || topCard.name !== '闪') return;
    // 满足条件:加标签标记可追杀,并把目标写入 localVars 供 confirm action 读取
    await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: TAG });
    if (typeof atom.target === 'number') {
      ctx.state.localVars[TARGET_KEY(ownerId)] = atom.target;
    }
  });

  // ── confirm action:玩家选择是否追杀 ──
  // requestType 与本 action 的 skillId 保持一致,harness 的 confirm() 会用
  // pendingSlot.atom.requestType 作为 skillId dispatch 找到本 entry。
  registerAction(
    '青龙偃月刀/可追杀',
    ownerId,
    'confirm',
    (_state, params: Record<string, Json>): string | null => {
      if (typeof params.choice !== 'boolean') return 'choice required';
      return null;
    },
    async (state, params: Record<string, Json>) => {
      const choice = params.choice as boolean;
      // 先摘掉标签(无论是否追杀,追杀机会一次性消耗)
      await applyAtom(state, { type: '去标签', player: ownerId, tag: TAG });
      if (!choice) return;
      // 追杀:对同一目标再询问一次闪
      const target = state.localVars[TARGET_KEY(ownerId)] as number | undefined;
      if (typeof target !== 'number') return;
      delete state.localVars[TARGET_KEY(ownerId)];
      await applyAtom(state, { type: '询问闪', target, source: ownerId });
    },
  );

  return () => {};
}

export default { createSkill, onInit };