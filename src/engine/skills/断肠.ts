// 断肠(蔡文姬·锁定技):杀死你的角色立即失去所有技能直到游戏结束。
//
// 模式:造成伤害 after(记录致死来源)+ 失去体力 after(清除来源)+ 击杀 before(移除技能)。
//
// 关键点:
//   - 「击杀」atom 不携带伤害来源,故断肠在「造成伤害」after-hook 中把来源记入
//     localVars['断肠/killer'](非系统 hook 先于系统规则濒死检查执行,记录先于击杀)。
//   - 体力致死(失去体力)无来源:对应的 after-hook 清除 killer 记录,避免误伤。
//   - 「失去所有技能」=移除该角色的武将技,保留 DEFAULT_SKILLS(基本出牌机制)与
//     当前装备自带技能(FAQ:装备效果仍生效)。
//   - 锁定技,自动触发,无需询问。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  HookResult,
  Skill,
  GameState,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, registerBeforeHook } from '../skill';
import { DEFAULT_SKILLS } from '../atoms/选将';

const KILLER_KEY = '断肠/killer';
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

  // ── 造成伤害 after:记录伤害来源(蔡文姬为受伤目标时)──
  // 非系统 hook 先于系统规则濒死检查执行,确保 killer 在击杀前已记录。
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; source?: number; amount?: number };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.source === undefined) return;
    if (atom.source === ownerId) return; // 自伤不记录(自杀无意义)
    ctx.state.localVars[KILLER_KEY] = atom.source;
  });

  // ── 失去体力 after:清除来源记录(体力致死无来源,避免误伤)──
  registerAfterHook(state, skill.id, ownerId, '失去体力', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number };
    if (atom.target !== ownerId) return;
    delete ctx.state.localVars[KILLER_KEY];
  });

  // ── 击杀 before:蔡文姬死亡时,移除杀手全部武将技 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '击杀',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number };
      if (atom.type !== '击杀') return;
      if (atom.player !== ownerId) return; // 仅蔡文姬本人死亡时触发

      const killer = ctx.state.localVars[KILLER_KEY] as number | undefined;
      delete ctx.state.localVars[KILLER_KEY];
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
    },
  );

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
