// 谦逊(陆逊·锁定技):你不能成为【顺手牵羊】和【乐不思蜀】的目标。
//
// 实现:before-hook 拦截,与 空城 同构(空城亦在"成为目标"before 阶段 cancel,
//   杀.validate 并不检查空城——引擎"不能成为目标"类锁定技统一走 effect-level cancel)。
//
//   顺手牵羊 / 乐不思蜀 不调用「成为目标」atom(与杀/决斗不同),目标合法性仅在各自
//   use.validate 中校验,无通用"成为目标"钩点。故谦逊挂在这两张牌结算流程中各自必经的 atom:
//     - 乐不思蜀:必经「添加延时锦囊」(放置判定区延时锦囊)→ before cancel 即免疫
//     - 顺手牵羊:必经「获得」(从目标区域取走一张牌)→ before cancel 即不被取牌
//
//   顺手牵羊 与 反馈/突袭 等"获得牌"的区别:用 topFrame(state).skillId === '顺手牵羊'
//   精确区分(顺手牵羊.execute 在 获得 期间持有结算帧;反馈在 造成伤害 after-hook 内
//   发起获得,顶帧是伤害来源帧如'杀',不会误判)。
//
//   被 cancel 后:锦囊本身仍按各自 execute 正常进弃牌堆(牌已消耗),陆逊不受影响——
//   与空城"杀牌仍进弃牌堆、诸葛亮不受伤害"行为一致。
import type { AtomBeforeContext, HookResult, Skill, GameState } from '../types';
import { topFrame } from '../create-engine';
import { registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '谦逊',
    description: '锁定技:你不能成为顺手牵羊和乐不思蜀的目标',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 乐不思蜀:拦截「添加延时锦囊」──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '添加延时锦囊',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number; trick?: { name?: string } };
      if (atom.player !== ownerId) return;
      if (atom.trick?.name !== '乐不思蜀') return;
      // 陆逊不能成为乐不思蜀的目标 → 不放置延时锦囊
      return { kind: 'cancel' };
    },
  );

  // ── 顺手牵羊:拦截「获得」(仅限顺手牵羊发起的获得)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '获得',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { from?: number; player?: number };
      if (atom.from !== ownerId) return; // 别人从陆逊处获得
      if (atom.player === ownerId) return; // 自己获得自己不算
      // 仅拦截顺手牵羊发起的获得(精确区分反馈/突袭等)
      const frame = topFrame(ctx.state);
      if (frame?.skillId !== '顺手牵羊') return;
      // 陆逊不能成为顺手牵羊的目标 → 不被取走牌
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
