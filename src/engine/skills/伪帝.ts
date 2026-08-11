// 伪帝(袁术·群·锁定技,风林火山 hero/100):
//   锁定技,你视为拥有主公的主公技。
//
// 机制:
//   - 回合开始 after-hook(整局首次触发且场上有主公时):将主公的主公技复制给袁术。
//   - 主公 = identity==='主公' 的存活玩家(且非袁术自己);主公技 = 该玩家 skills ∩ LORD_SKILLS。
//   - 主公在游戏开始时即确定(分配武将先于技能实例化),故首回合开始即可复制;
//     若首回合尚无主公(极端情况),后续每回合开始再检查,直至复制完成。
//   - 复制 = 对每个主公技 applyAtom(添加技能),由引擎统一实例化(注册其 action/hook)。
//   - 整局一次(per-owner flag 防重入)。
//
// 关于复制后主公技的发动能力:本技能只负责「拥有」(把主公技挂到袁术身上)。
//   各主公技内部对「主公位」的判定不一致——护驾(标版)无座次门槛,袁术可直接发动;
//   激将/救援/制霸等以 ownerId===0 为门槛,袁术(非 0 号位)暂无法发动,需引擎层
//   「有效主公」判定统一后方可。此为引擎横切关注点,不在本技能职责内。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { LORD_SKILLS } from '../data/character-meta';

/** per-owner 已复制标记(防重入,整局一次)。 */
const GRANTED_KEY = '伪帝/granted';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '伪帝',
    description: '锁定技,你视为拥有主公的主公技',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  const unload = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '回合开始',
    async (ctx) => {
      const st = ctx.state;
      const me = st.players[ownerId];
      if (!me?.alive) return;
      if (me.vars[GRANTED_KEY]) return; // 已复制

      // 找主公:身份为主公的存活玩家(排除袁术自己——袁术本身非常备主公)
      const lord = st.players.find(
        (p) => p.alive && p.identity === '主公' && p.index !== ownerId,
      );
      if (!lord) return; // 场上无主公,后续回合开始再检查

      // 主公的主公技 = skills ∩ LORD_SKILLS
      const lordSkills = lord.skills.filter((s) => LORD_SKILLS.has(s));
      if (lordSkills.length === 0) return;

      // 标记在前(防重入),再逐个复制
      me.vars[GRANTED_KEY] = true;
      for (const skillId of lordSkills) {
        await applyAtom(st, { type: '添加技能', player: ownerId, skillId });
      }
    },
  );

  return () => {
    unload();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技,被动触发,无主动 action
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
