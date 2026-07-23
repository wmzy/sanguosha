// 激昂(孙策·被动技):每当你使用(指定目标后)或被使用(成为目标后)
//   一张【决斗】或红色的【杀】时,你可以摸一张牌。
//
// 模式 A(被动触发):after hook 挂在「成为目标」。
//   杀 的结算流程:声明阶段逐个 指定目标 → 结算阶段逐个 成为目标。
//   决斗(及离间)的结算在 runUseFlow virtual 模式中也发 成为目标(source=发起者,target=目标)。
//   因此挂「成为目标」after-hook 一处即可覆盖全部 4 种情形:
//     - 孙策使用红杀(atom.source===ownerId)
//     - 孙策被使用红杀(atom.target===ownerId)
//     - 孙策使用决斗(atom.source===ownerId,帧为决斗/离间)
//     - 孙策被使用决斗(atom.target===ownerId,帧为决斗/离间)
//
// 关键点:
//   - 红色杀:card.color==='红'(♥/♦),含转化后的红杀(武圣红牌当杀保留原色)
//   - 决斗判定:实卡 card.name==='决斗';离间等无实体牌的虚拟决斗用 topFrame.skillId
//     ∈ {'决斗','离间'} 兜底
//   - "一张杀"语义:孙策作为使用者时,多目标杀(方天画戟/天义)只触发一次,
//     故对 source 情形按 cardId 去重(localVars 标记);target 情形孙策只是单一目标,天然一次
//   - "可以摸一张牌":可选,询问 confirm;不发动则不摸
//   - 无次数限制(FAQ 明确)
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_RT = '激昂/confirm';
const CONFIRMED_KEY = '激昂/confirmed';
/** source 情形去重:已为本 cardId 触发过(localVars 标记,键含 cardId) */
function srcDoneKey(cardId: string): string {
  return `激昂/src/${cardId}`;
}

/** 判定本次「成为目标」是否为激昂可触发场景(决斗或红色杀) */
function isJiangTrigger(state: GameState, cardId: string | undefined): boolean {
  const card = cardId ? state.cardMap[cardId] : undefined;
  if (card?.name === '决斗') return true;
  if (card?.name === '杀' && card.color === '红') return true;
  // 虚拟决斗(离间无实体牌):用当前结算帧兜底
  const frameSkill = topFrame(state)?.skillId;
  if (frameSkill === '决斗' || frameSkill === '离间') return true;
  return false;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '激昂',
    description: '使用或被使用【决斗】或红色【杀】时,你可以摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:孙策本人回应是否发动激昂 ──
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
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是激昂确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 成为目标 after hook:覆盖使用/被使用 全部情形 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '成为目标',
    async (ctx): Promise<void> => {
      const atom = ctx.atom;
      const involved = atom.source === ownerId || atom.target === ownerId;
      if (!involved) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (!isJiangTrigger(ctx.state, atom.cardId)) return;

      // source 情形去重:多目标杀只触发一次
      if (atom.source === ownerId) {
        const cardId = atom.cardId ?? '__virtual__';
        const key = srcDoneKey(cardId);
        if (ctx.state.localVars[key]) return;
        ctx.state.localVars[key] = true;
      }

      // 询问是否发动(可选)
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动激昂?(摸一张牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return;

      // 发动:摸一张牌
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '激昂',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动激昂?(摸一张牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
