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
      if (
        requestType !== '流离/confirm' &&
        requestType !== '流离/chooseTarget' &&
        requestType !== '流离/pickDiscard'
      )
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
      if (requestType === '流离/pickDiscard') {
        // 权威校验:必须恰好 1 张且在自己的手牌中(防注入他人手牌 id 复制/丢牌)
        const cardIds = _params.cardIds;
        if (!Array.isArray(cardIds) || cardIds.length !== 1) return '请选择弃置的 1 张手牌';
        const cid = cardIds[0];
        if (typeof cid !== 'string' || !state.players[ownerId].hand.includes(cid)) {
          return '弃置牌不在你的手牌中';
        }
      }
      return null;
    },
    async (state, params) => {
      const requestType = (
        state.pendingSlots.get(ownerId)?.atom as unknown as Record<string, unknown>
      )?.requestType as string;
      if (requestType === '流离/confirm') {
        state.localVars['流离/confirmed'] = params.choice === true || params.confirmed === true;
      } else if (requestType === '流离/pickDiscard') {
        state.localVars['流离/discard'] = (params.cardIds as string[])[0];
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

    // 询问弃置哪张手牌(官方:玩家自选弃牌;不能固定弃第一张——会强行丢掉桃/无懈等关键牌)。
    // 对齐 界放权 代价支付范式:超时/不合法 → 未支付代价,不发动(不弃牌不转移)。
    delete ctx.state.localVars['流离/discard'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '流离/pickDiscard',
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: '流离:弃置 1 张手牌',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      timeout: 15,
    });
    const payer = ctx.state.players[ownerId];
    const picked = ctx.state.localVars['流离/discard'] as string | undefined;
    delete ctx.state.localVars['流离/discard'];
    if (typeof picked !== 'string' || !payer.hand.includes(picked)) {
      // 未支付代价:不弃牌、不转移(杀仍指向原目标)。已写入的中间状态一并清理,
      // 否则残留的 流离/target 会误导后续回合/hook。
      delete ctx.state.localVars['流离/target'];
      delete ctx.state.localVars['流离/来源'];
      return;
    }
    const discardCard = picked;
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
