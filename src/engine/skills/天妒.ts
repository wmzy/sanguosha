// 天妒(郭嘉·被动技):当你的判定牌生效后,你可以获得此判定牌。
//
// 时机:判定牌生效后 hook(runJudgeFlow 在判定牌生效后、收尾将其入弃牌堆之前触发——
//   判定牌此刻仍在 frameCards 末尾)。
// 实现:询问是否获得 → 移动牌(处理区→手牌)。判定阶段 frame 通常仅含判定牌,
//   拿走后 frame 空,runJudgeFlow 收尾 splice 末尾为 no-op。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { currentJudgeCardId } from '../flows/judge';
import { registerAfterHook } from '../core/skill';
import { askConfirm, registerConfirmRespond } from '../util/skillRuntime';

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
  registerConfirmRespond(state, skill.id, ownerId, CHOOSE_RT, CHOICE_KEY, {
    mismatchError: '当前不是天妒选择',
  });

  // 判定牌生效后:自己的判定 → 询问是否获得判定牌
  registerAfterHook(state, skill.id, ownerId, '判定牌生效后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;

    const judgeCardId = currentJudgeCardId(ctx.state);
    if (!judgeCardId) return;
    // 安全前提:本次判定私有处理区仅含判定牌,多牌父帧跳过获取。
    const processing = ctx.state.settlementStack.at(-1)?.cards ?? [];
    if (processing.length > 1) return;
    if (!ctx.state.cardMap[judgeCardId]) return;

    // 询问是否获得
    const want = await askConfirm(ctx.state, CHOOSE_RT, ownerId, {
      confirmedKey: CHOICE_KEY,
      title: '天妒:获得判定牌?',
      confirmLabel: '获得',
      cancelLabel: '不获得',
      defaultChoice: false,
      timeout: 10,
    });
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
