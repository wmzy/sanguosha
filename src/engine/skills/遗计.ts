// 遗计(郭嘉·被动技):当你受到 1 点伤害后,你可以摸两张牌,
// 然后将两张牌交给任意角色(每 1 点伤害触发一次)。
// 遗计(郭嘉·被动技):当你受到 1 点伤害后,你可以摸两张牌,
// 然后将两张牌交给任意角色(每 1 点伤害触发一次)。
import type { AtomAfterContext, FrontendAPI, Skill, GameState } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '遗计',
    description: '受到 1 点伤害后,摸两张牌,然后将两张牌交给任意角色',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // respond:遗计分配牌,设 localVars 记录分配结果
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, _params) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (
        state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>
      ).requestType as string;
      if (requestType !== '遗计/distribute') return '当前不是遗计分配';
      return null;
    },
    async (state, params) => {
      state.localVars['遗计/allocation'] = params.allocation ?? null;
    },
  );

  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    if ((ctx.atom as { target?: number }).target !== ownerId) return;
    const amount = (ctx.atom as { amount?: number }).amount ?? 0;
    if (amount <= 0) return;

    // 每 1 点伤害触发一次遗计
    for (let i = 0; i < amount; i++) {
      const handBefore = ctx.state.players[ownerId].hand.length;
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 2 });
      const drawnCards = ctx.state.players[ownerId].hand.slice(handBefore);

      // 询问分配
      delete ctx.state.localVars['遗计/allocation'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '遗计/distribute',
        target: ownerId,
        prompt: {
          type: 'distribute',
          title: '遗计:分配两张牌',
          cardIds: drawnCards,
          minPerTarget: 1,
          maxPerTarget: 2,
        },
        timeout: 30,
      });

      const distribution = ctx.state.localVars['遗计/allocation'] as Array<{
        target: number;
        cardIds: string[];
      }> | null;
      if (Array.isArray(distribution)) {
        for (const entry of distribution) {
          for (const cardId of entry.cardIds) {
            await applyAtom(ctx.state, { type: '给予', cardId, from: ownerId, to: entry.target });
          }
        }
      }
      delete ctx.state.localVars['遗计/allocation'];
    }
  });
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '遗计',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动遗计？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
