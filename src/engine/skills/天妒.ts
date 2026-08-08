// 天妒(郭嘉·被动技):当你的判定牌生效后,你可以获得此判定牌。
//
// 时机:判定牌生效后 hook(runJudgeFlow 在判定牌生效后、收尾将其入弃牌堆之前触发——
//   判定牌此刻仍在 frameCards 末尾)。
// 实现:询问是否获得 → 移动牌(处理区→手牌)。判定阶段 frame 通常仅含判定牌,
//   拿走后 frame 空,runJudgeFlow 收尾 splice 末尾为 no-op。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom, frameCards } from '../index';
import { registerAction, registerAfterHook } from '../core/skill';

const CHOOSE_RT = '天妒/choose';
const CHOICE_KEY = '天妒/choice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '天妒',
    description: '当你的判定牌生效后,你可以获得此判定牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:玩家在「天妒/choose」询问下的选择
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CHOOSE_RT) return '当前不是天妒选择';
      return null;
    },
    async (s, params) => {
      s.localVars[CHOICE_KEY] = params.choice === true;
    },
  );

  // 判定牌生效后:自己的判定 → 询问是否获得判定牌
  registerAfterHook(state, skill.id, ownerId, '判定牌生效后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;

    // 判定牌生效后,判定牌仍在 frameCards 末尾(尚未入弃牌堆)
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    // 安全前提:frame.cards 仅含判定牌(典型场景:判定阶段/独立判定)。若 frame 还含
    // 其他牌(如杀结算中八卦阵判定),拿走判定牌会使 runJudgeFlow 收尾 splice 误删
    // 其他牌(判定牌的清理盲取末尾)→ 状态损坏。多牌场景跳过获取,与 界落英 一致。
    if (processing.length > 1) return;
    const judgeCardId = processing[processing.length - 1];
    if (!ctx.state.cardMap[judgeCardId]) return;

    // 询问是否获得
    delete ctx.state.localVars[CHOICE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '天妒:获得判定牌?',
        confirmLabel: '获得',
        cancelLabel: '不获得',
      },
      defaultChoice: false,
      timeout: 10,
    });

    const want = ctx.state.localVars[CHOICE_KEY] === true;
    delete ctx.state.localVars[CHOICE_KEY];
    if (!want) return;

    // 获得判定牌(处理区→手牌);拿走后判定 atom 的 afterHooks 清理为 no-op
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: judgeCardId,
      from: { zone: '处理区' },
      to: { zone: '手牌', player: ownerId },
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '天妒',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动天妒?',
      confirmLabel: '获得判定牌',
      cancelLabel: '不获得',
    },
  });
}
