// 断肠(蔡文姬·锁定技):杀死你的角色立即失去所有技能直到游戏结束。
//
// 模式:死亡时 after-hook(系统处理牌之前,凶手技能尚在)。
//   runDeathFlow 发出 死亡时 atom 时,atom.killer 携带致死来源(由 runDecreaseLifeFlow
//   写入 localVars['死亡/killer'],runDyingFlow 透传)。蔡文姬为阵亡者时触发,
//   移除凶手全部武将技。
//
// 关键点(模块 B 重构后):
//   - killer 直接从 死亡时 atom 读取,不再需要 受到伤害后/失去体力 自行记录 localVars
//     (原 断肠/killer 通道已删除)。
//   - 「失去所有技能」=移除该角色的武将技,保留 DEFAULT_SKILLS(基本出牌机制)与
//     当前装备自带技能(FAQ:装备效果仍生效)。
//   - 锁定技,自动触发,无需询问。
import type {
  Skill,
  GameState,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';
import { DEFAULT_SKILLS } from '../atoms/选将';

const DEFAULT_SKILLS_SET = new Set<string>(DEFAULT_SKILLS);

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '断肠',
    description: '杀死你的角色立即失去所有技能直到游戏结束(装备仍生效)',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 死亡时 after:蔡文姬死亡时(系统处理牌之前),移除杀手全部武将技 ──
  // killer 由 死亡时 atom 携带(runDeathFlow 从 localVars['死亡/killer'] 透传)。
  registerAfterHook(state, skill.id, ownerId, '死亡时', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '死亡时') return;
    if (atom.player !== ownerId) return; // 仅蔡文姬本人死亡时触发

    const killer = atom.killer;
    if (killer === undefined) return; // 无来源(如体力致死)
    if (killer === ownerId) return; // 自杀:自己已死,无需移除

    const killerPlayer = ctx.state.players[killer];
    if (!killerPlayer?.alive) return;

    // 保留 DEFAULT_SKILLS(出牌机制)与当前装备自带技能(FAQ:装备仍生效)
    const equippedNames = new Set<string>();
    for (const id of Object.values(killerPlayer.equipment)) {
      if (!id) continue;
      const name = ctx.state.cardMap[id]?.name;
      if (name) equippedNames.add(name);
    }
    const toRemove = killerPlayer.skills.filter(
      (s) => !DEFAULT_SKILLS_SET.has(s) && !equippedNames.has(s),
    );
    for (const skillId of toRemove) {
      await applyAtom(ctx.state, { type: '移除技能', player: killer, skillId });
    }
  });

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
