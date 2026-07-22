// 颂威(曹丕·主公技):其他魏势力角色的判定牌结果为黑色且生效后,可以让你摸一张牌。
//
// 模式 A(被动触发):after hook 挂在「判定」。
//   判定(player≠曹丕 + faction=魏 + 判定牌黑色) → 询问曹丕是否摸牌 → 摸牌(1)
//
// 关键点:
//   - 判定牌在 frame.cards 末尾(在判定.afterHooks 移入弃牌堆之前)
//   - 黑色 = ♠ 或 ♣
//   - faction 从 player.faction 读取
//   - 仅主公曹丕可用(isLord 判定),非主公时 hook 注册但不触发(主公技限制)
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_RT = '颂威/confirm';
const CONFIRMED_KEY = '颂威/confirmed';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '颂威',
    description: '主公技:其他魏势力角色判定牌黑色且生效后,你可以摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:曹丕回应是否发动颂威 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是颂威确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 判定 after hook:其他魏势力角色黑色判定牌 → 询问曹丕摸牌 ──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.player === ownerId) return; // 自己的判定不触发
    const judgePlayer = ctx.state.players[atom.player ?? -1];
    if (!judgePlayer?.alive) return;
    if (judgePlayer.faction !== '魏') return; // 仅魏势力

    // 读取判定牌花色(frame.cards 末尾,在判定.afterHooks 移入弃牌堆之前)
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 非黑色判定牌不触发
    if (judgeCard.suit !== '♠' && judgeCard.suit !== '♣') return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 询问是否摸牌
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `颂威:${judgePlayer.name} 判定牌为${judgeCard.suit}${judgeCard.rank},是否摸一张牌?`,
        confirmLabel: '摸牌',
        cancelLabel: '不摸',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 摸一张牌
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '颂威',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '颂威:是否摸一张牌?',
      confirmLabel: '摸牌',
      cancelLabel: '不摸',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
