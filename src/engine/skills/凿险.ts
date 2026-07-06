// 凿险(邓艾·觉醒技):准备阶段,若"田"的数量≥3,你须减1点体力上限,
//   然后获得技能"急袭"(将一张"田"当【顺手牵羊】使用)。
//
// 模式 A(被动触发):after hook 挂在「阶段开始」(phase=准备)。
//   阶段开始(准备, player=自己) → 田≥3 → 设上限(maxHealth-1) → 添加技能(急袭)
//
// 关键点:
//   - 觉醒技:整局一次(player.vars['凿险/awakened'] 防重入)
//   - 田数量 = marks 中 `屯田/田:` 前缀的 mark 数量
//   - 减上限后若体力>新上限,设上限 atom 自动 clamp(参考 types.ts 设上限定义)
//   - 急袭技能模块需在 skills/index.ts 注册
import type { AtomAfterContext, FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

const AWAKENED_KEY = '凿险/awakened';
const TIAN_PREFIX = '屯田/田:';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '凿险',
    description: '觉醒技:准备阶段田≥3时,减1体力上限并获得"急袭"(田当顺手牵羊)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 阶段开始(准备) after hook:检查觉醒条件 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '准备') return;
    if (atom.player !== ownerId) return;

    // 觉醒技:整局一次
    if (ctx.state.players[ownerId]?.vars[AWAKENED_KEY]) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 田数量检查
    const tianCount = self.marks.filter((m) => m.id.startsWith(TIAN_PREFIX)).length;
    if (tianCount < 3) return;

    // 标记已觉醒(在读条件后立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 减1点体力上限(设上限 amount = maxHealth - 1,需 > 0)
    const newMax = self.maxHealth - 1;
    if (newMax > 0) {
      await applyAtom(ctx.state, { type: '设上限', player: ownerId, amount: newMax });
    }

    // 2. 获得技能"急袭"
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '急袭' });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 觉醒技无主动 action;前端通过 view.marks 展示田数量。
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
