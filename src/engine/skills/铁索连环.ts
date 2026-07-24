// 铁索连环(普通锦囊):
//   use:出牌阶段,横置或重置一至两名角色的连环状态(可被无懈可击)。
//   recast(重铸):弃此牌,摸一张牌。
//
// use 结算逻辑已迁移到 card-effects/铁索连环.ts (CardEffect.resolve)。
// 使用牌技能按卡名注册 use action,execute 调 runUseFlow 编排完整使用结算流程。
//
// 本文件仅保留:
//   1. recast action(重铸:弃牌+摸1张)——自定义 actionType,不走标准使用流程
//   2. 连环传导 hook(全局唯一)——属性伤害传导给所有横置角色
//
// 连环状态(铁索传导):全局 after-hook(造成伤害)。
//   处于连环状态的角色受到属性伤害(火焰/雷电)时,从该角色开始,
//   依次传导至其他所有处于连环状态的角色(同等同属性伤害);
//   传导完毕后重置所有因此传导的角色的连环状态。
//   hook 在 DEFAULT_SKILLS 实例化时注册(使用牌先于本技能),晚于系统规则的濒死 hook → LIFO 保证先于濒死执行。
//   localVars[CONDUCTING_VAR] 防止传导伤害递归触发。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { TARGET_SYSTEM } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { setChain } from '../face-down';
import { runDamageFlow } from '../damage-flow';
import { registerAction, registerAfterHook, validateUseCard, type SkillModule } from '../skill';

const CHAIN_MARK = 'chained';
const CONDUCTING_VAR = '铁索连环/传导中';

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
  const unloads: Array<() => void> = [];

  // ── recast:重铸(弃此牌,摸一张)──
  const recastUnload = registerAction(
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
  unloads.push(recastUnload);

  // ── 连环传导 hook(全局唯一,首个实例注册)──
  if (!state.localVars[CONDUCTING_VAR + 'hook已注册']) {
    state.localVars[CONDUCTING_VAR + 'hook已注册'] = true;
    registerAfterHook(state, '铁索连环', -1, '伤害结算结束后', async (ctx) => {
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
          await runDamageFlow(ctx.state, source, p.index, amount, undefined, dt);
        }
        // 重置所有处于连环状态的角色(含原始目标)
        const allChained = ctx.state.players.filter((p) =>
          p.marks.some((m) => m.id === CHAIN_MARK),
        );
        for (const p of allChained) {
          await setChain(ctx.state, p.index, false);
        }
      } finally {
        delete ctx.state.localVars[CONDUCTING_VAR];
      }
    });
  }

  return () => unloads.forEach((u) => u());
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('recast', {
    label: '铁索连环·重铸',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '铁索连环:重铸(弃此牌,摸一张)',
      cardFilter: { filter: (c) => c.name === '铁索连环', min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
