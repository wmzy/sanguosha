// 流离(大乔·被动技):当你成为【杀】的目标时,可以弃一张牌,
// 将此杀转移给攻击范围内的一名其他角色。
// 时机:成为目标 after hook(结算阶段),修改杀帧的 resolvedTargets。
// 流离(大乔·被动技):当你成为【杀】的目标时,可以弃一张牌,
// 将此杀转移给攻击范围内的一名其他角色。
// 时机:成为目标 after hook(结算阶段),修改杀帧的 resolvedTargets。
import type { AtomAfterContext, FrontendAPI, Skill, GameState } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';
import { inAttackRange } from '../distance';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '流离',
    description: '当你成为杀的目标时,可弃一张牌,将此杀转移给攻击范围内一名其他角色',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // respond:流离 confirm 和 chooseTarget
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
      if (requestType !== '流离/confirm' && requestType !== '流离/chooseTarget')
        return '当前不是流离回应';
      return null;
    },
    async (state, params) => {
      const requestType = (
        state.pendingSlots.get(ownerId)?.atom as unknown as Record<string, unknown>
      )?.requestType as string;
      if (requestType === '流离/confirm') {
        state.localVars['流离/confirmed'] = params.choice === true || params.confirmed === true;
      } else {
        state.localVars['流离/target'] = params.target;
      }
    },
  );

  registerAfterHook(state, skill.id, ownerId, '成为目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
    if (atom.target !== ownerId) return;
    const selfPlayer = ctx.state.players[ownerId];
    if (!selfPlayer || selfPlayer.hand.length === 0) return;

    // 询问是否发动流离
    delete ctx.state.localVars['流离/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '流离/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动流离?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars['流离/confirmed']) return;

    // 询问选择新目标(在杀来源的攻击范围内)
    delete ctx.state.localVars['流离/target'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '流离/chooseTarget',
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '流离:选择转移目标',
        min: 1,
        max: 1,
        filter: (view, target) =>
          target !== ownerId &&
          view.players[target]?.alive === true &&
          inAttackRange(ctx.state, atom.source!, target),
      },
      timeout: 15,
    });
    const newTarget = ctx.state.localVars['流离/target'] as number | undefined;
    if (typeof newTarget !== 'number' || newTarget === ownerId) return;

    // 弃 1 张牌
    const discardCard = selfPlayer.hand[0];
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCard] });

    // 修改杀帧 resolvedTargets 中的当前目标为新目标
    const resolvedTargets = ctx.frame.params.resolvedTargets as number[] | undefined;
    if (resolvedTargets) {
      const idx = resolvedTargets.indexOf(ownerId);
      if (idx >= 0) resolvedTargets[idx] = newTarget;
    }
    delete ctx.state.localVars['流离/confirmed'];
    delete ctx.state.localVars['流离/target'];
  });
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '流离',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动流离？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
