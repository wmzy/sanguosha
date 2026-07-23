// 铁索连环(普通锦囊):
//   use:出牌阶段,横置或重置一至两名角色的连环状态(可被无懈可击)。
//   recast(重铸):弃此牌,摸一张牌。
//
// use 结算逻辑已迁移到 card-effects/铁索连环.ts (CardEffect.resolve)。
// execute 委托 runUseFlow 编排完整使用结算流程（文档 use.md）。
//
// recast 不走 runUseFlow（重铸无目标/无结算），保留独立 action。
// 连环传导 hook（全局唯一）仍在此注册。
//
// 连环状态(铁索传导):全局 after-hook(造成伤害)。
//   处于连环状态的角色受到属性伤害(火焰/雷电)时,从该角色开始,
//   依次传导至其他所有处于连环状态的角色(同等同属性伤害);
//   传导完毕后重置所有因此传导的角色的连环状态。
//   hook 在 DEFAULT_SKILLS 实例化时注册,晚于系统规则的濒死 hook → LIFO 保证先于濒死执行。
//   localVars[CONDUCTING_VAR] 防止传导伤害递归触发。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { TARGET_SYSTEM } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, validateUseCard } from '../skill';
import { defaultPlayActive } from '../action-active';
import { runUseFlow } from '../card-effect/use-card';

const CHAIN_MARK = 'chained';
const CONDUCTING_VAR = '铁索连环/传导中';
const HOOK_REGISTERED_VAR = '铁索连环/传导hook已注册';

type DamageType = '普通' | '火焰' | '雷电';

export function isChained(state: GameState, idx: number): boolean {
  return state.players[idx]?.marks.some((m) => m.id === CHAIN_MARK) ?? false;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '铁索连环',
    description: '横置/重置一至两名角色;或重铸',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── use:横置/重置 1-2 名角色 —— 委托 runUseFlow ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const base = validateUseCard(state, ownerId, params, { cardName: '铁索连环' });
      if (base) return base;
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length < 1 || targets.length > 2)
        return '需选择一至两名角色';
      for (const t of targets) {
        if (!state.players[t]?.alive) return '目标不合法';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const targets = params.targets as number[];
      await runUseFlow(state, ownerId, cardId, targets, '铁索连环');
    },
  );

  // ── recast:重铸(弃此牌,摸一张)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'recast',
    (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '铁索连环' });
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      await pushFrame(state, '铁索连环', ownerId, { ...params });
      await applyAtom(state, { type: '弃置', player: ownerId, cardIds: [cardId] });
      await applyAtom(state, { type: '摸牌', player: ownerId, count: 1 });
      await popFrame(state);
    },
  );

  // ── 连环传导 hook(全局唯一,首个实例注册)──
  if (!state.localVars[HOOK_REGISTERED_VAR]) {
    state.localVars[HOOK_REGISTERED_VAR] = true;
    registerAfterHook(state, '铁索连环', -1, '造成伤害', async (ctx) => {
      const atom = ctx.atom;
      const dt = atom.damageType as DamageType | undefined;
      if (dt !== '火焰' && dt !== '雷电') return;
      const target = atom.target;
      if (typeof target !== 'number') return;
      if (!isChained(ctx.state, target)) return;
      if (ctx.state.localVars[CONDUCTING_VAR]) return;

      ctx.state.localVars[CONDUCTING_VAR] = true;
      try {
        const amount = atom.amount ?? 1;
        const source = atom.source ?? TARGET_SYSTEM;
        // 传导给其他所有横置的存活角色(按座次)
        const others = ctx.state.players.filter(
          (p) => p.alive && p.index !== target && p.marks.some((m) => m.id === CHAIN_MARK),
        );
        for (const p of others) {
          if (!ctx.state.players[p.index]?.alive) continue; // 传导链中可能死亡
          await applyAtom(ctx.state, {
            type: '造成伤害',
            target: p.index,
            amount,
            source,
            damageType: dt,
          });
        }
        // 重置所有处于连环状态的角色(含原始目标)
        const allChained = ctx.state.players.filter((p) =>
          p.marks.some((m) => m.id === CHAIN_MARK),
        );
        for (const p of allChained) {
          await applyAtom(ctx.state, { type: '设横置', player: p.index, chained: false });
        }
      } finally {
        delete ctx.state.localVars[CONDUCTING_VAR];
      }
    });
  }

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '铁索连环',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '铁索连环',
      cardFilter: { filter: (c) => c.name === '铁索连环', min: 1, max: 1 },
      targetFilter: { min: 1, max: 2 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      return ctx.view.players[ctx.perspectiveIdx]?.hand?.some((c) => c.name === '铁索连环') ?? false;
    },
  });
  api.defineAction('recast', {
    label: '铁索连环·重铸',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '铁索连环:重铸(弃此牌,摸一张)',
      cardFilter: { filter: (c) => c.name === '铁索连环', min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      return ctx.view.players[ctx.perspectiveIdx]?.hand?.some((c) => c.name === '铁索连环') ?? false;
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
