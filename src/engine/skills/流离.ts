// 流离(大乔·被动技):当你成为【杀】的目标时,可以弃一张牌,
// 将此杀转移给攻击范围内的一名其他角色。
// 时机:成为目标 after hook(结算阶段),修改杀帧的 resolvedTargets。
// 流离(大乔·被动技):当你成为【杀】的目标时,可以弃一张牌,
// 将此杀转移给攻击范围内的一名其他角色。
// 时机:成为目标 after hook(结算阶段),修改杀帧的 resolvedTargets。
import type { FrontendAPI, Skill, GameState } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import { inAttackRange } from '../rules/distance';

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
      if (requestType === '流离/chooseTarget') {
        // 服务端兜底:candidates 仅约束前端展示,恶意提交仍须权威校验(与 prompt.filter 同源)。
        // 杀来源由 hook 存入 localVars(pending atom 本身无 source 字段)
        const t = _params.target;
        if (typeof t !== 'number') return '请选择转移目标';
        if (t === ownerId) return '不能转移给自己';
        const src = state.localVars['流离/来源'];
        if (t === src) return '不能转移给杀的来源';
        if (!state.players[t]?.alive) return '目标不存活';
        if (!inAttackRange(state, ownerId, t)) return '目标不在你的攻击范围内';
      }
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

  registerAfterHook(state, skill.id, ownerId, '成为目标', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    // 流离仅在成为【杀】的目标时触发(决斗/借刀杀人等其他牌同样发「成为目标」,不应触发)
    const triggerCardId = atom.cardId;
    if (!triggerCardId) return;
    const triggerCard = ctx.state.cardMap[triggerCardId];
    if (triggerCard?.name !== '杀') return;
    const selfPlayer = ctx.state.players[ownerId];
    if (!selfPlayer || selfPlayer.hand.length === 0) return;

    // 询问是否发动流离
    delete ctx.state.localVars['流离/confirmed'];
    ctx.state.localVars['流离/来源'] = atom.source; // respond 兜底校验用(pending atom 无 source)
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
        // 官方规则:「将此杀转移给你攻击范围内的一名其他角色」——主体是流离使用者(ownerId),
        // 而非杀来源 atom.source;且不含来源自己(转移后来源不能成为自己这张杀的目标)。
        filter: (view, target) =>
          target !== ownerId &&
          target !== atom.source &&
          view.players[target]?.alive === true &&
          inAttackRange(ctx.state, ownerId, target),
      },
      timeout: 15,
    });
    const newTarget = ctx.state.localVars['流离/target'] as number | undefined;
    if (typeof newTarget !== 'number' || newTarget === ownerId) return;

    // 弃 1 张牌
    const discardCard = selfPlayer.hand[0];
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCard], voluntary: true });

    // 修改杀帧 resolvedTargets 中的当前目标为新目标
    const resolvedTargets = ctx.frame.params.resolvedTargets as number[] | undefined;
    if (resolvedTargets) {
      const idx = resolvedTargets.indexOf(ownerId);
      if (idx >= 0) resolvedTargets[idx] = newTarget;
    }
    delete ctx.state.localVars['流离/confirmed'];
    delete ctx.state.localVars['流离/target'];
    delete ctx.state.localVars['流离/来源'];
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
