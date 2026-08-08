// 雌雄双股剑(武器,攻击范围 2):
//   你使用【杀】指定一名异性角色为目标后、杀结算前,你可以令其选择一项:
//   弃置一张手牌,或令你(使用者)摸一张牌。需性别校验(异性)。
//
// 实现:
//   1. 指定目标 after-hook(source===ownerId 且当前牌是 杀):
//        - 动态校核武器槽仍是本技能(owner 装备可能在同帧被换下)
//        - 性别校核:owner 与 target 必须异性(getGender),同性不触发
//        - 询问 owner 是否发动(你可以) → 不发动则跳过
//        - 若发动:令 target 选择一项 ——
//            选弃一张手牌(useCard 弹窗提交 cardId) → 弃该牌;
//            放弃/超时(pass) → owner 摸一张牌。
//          target 无手牌时只能让对方摸牌,直接 owner 摸1(跳过选择)。
//   2. respond action 注册到全座次:owner confirm 由 ownerId 座次回应;
//      target 的选择由 target 座次回应(可能任意座次),按 requestType 分流。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../index';
import { registerAction, registerAfterHook } from '../core/skill';
import { getGender } from '../data/character-meta';

/** owner 是否发动的确认询问 requestType */
const CONFIRM_REQUEST = '雌雄双股剑/confirm';
/** target 选择(弃牌/让对方摸牌)的询问 requestType */
const CHOICE_REQUEST = '雌雄双股剑/choice';
/** localVars key:owner confirm 结果(true=发动) */
const CONFIRMED_VAR = '雌雄双股剑/confirmed';
/** localVars key:target 选择弃置的 cardId(未设/超时=让对方摸牌) */
const CHOICE_VAR = '雌雄双股剑/discardId';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '雌雄双股剑',
    description: '武器:你使用杀指定异性角色为目标后,可令其弃1手牌或令你摸1牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const SKILL_ID = skill.id;

  // ── respond action:注册到全座次(owner confirm + target 选择均可能由不同座次回应)
  //   按 pending slot 的 requestType 分流,非本技能询问一律拒绝(无副作用)。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const pid = p.index;
    const unloader = registerAction(
      state,
      SKILL_ID,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (slot?.atom.type !== '请求回应') return '当前不需要回应';
        const reqType = (slot.atom as { requestType?: string }).requestType;
        if (reqType === CONFIRM_REQUEST) {
          // owner confirm:接受任意 choice(true/false)
          return null;
        }
        if (reqType === CHOICE_REQUEST) {
          // target 选择:提交 cardId = 弃该手牌;不提交/pass = 让对方摸牌
          const cardId = params.cardId as string | undefined;
          if (cardId !== undefined) {
            if (!st.players[pid].hand.includes(cardId)) return '牌不在手牌中';
          }
          return null;
        }
        return '当前不是雌雄双股剑询问';
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(pid);
        const reqType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
        if (reqType === CONFIRM_REQUEST) {
          st.localVars[CONFIRMED_VAR] = params.choice === true;
        } else if (reqType === CHOICE_REQUEST) {
          // cardId 缺省时写入 null,与"未设(超时)"区分仍视为让对方摸牌
          st.localVars[CHOICE_VAR] = (params.cardId) ?? null;
        }
      },
    );
    unloaders.push(unloader);
  }

  // ── 指定目标 after-hook:性别校核 + owner confirm + target 选择 ──
  const hookUnloader = registerAfterHook(
    state,
    SKILL_ID,
    ownerId,
    '指定目标',
    async (ctx) => {
      const atom = ctx.atom as { source: number; target: number; cardId?: string };
      if (atom.source !== ownerId) return;
      if (typeof atom.target !== 'number') return;

      // 仅杀触发
      if (!atom.cardId) return;
      const card = ctx.state.cardMap[atom.cardId];
      if (!card?.name.includes('杀')) return;

      const self = ctx.state.players[ownerId];
      const target = ctx.state.players[atom.target];
      if (!self || !target) return;

      // 动态装备校核(陷阱#8):owner 武器槽仍是本技能
      const weaponId = self.equipment['武器'];
      if (!weaponId) return;
      if (ctx.state.cardMap[weaponId]?.name !== '雌雄双股剑') return;

      // 性别校核:必须异性
      if (getGender(self.character) === getGender(target.character)) return;

      // owner 是否发动(你可以)
      delete ctx.state.localVars[CONFIRMED_VAR];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '雌雄双股剑:是否发动?(令目标弃1手牌,或你摸1张牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[CONFIRMED_VAR] !== true) {
        delete ctx.state.localVars[CONFIRMED_VAR];
        return;
      }
      delete ctx.state.localVars[CONFIRMED_VAR];

      // target 无手牌 → 只能令 owner 摸1(无法选择弃牌)
      if (target.hand.length === 0) {
        await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
        return;
      }

      // target 选择:弃一张手牌,或放弃(令 owner 摸一张牌)
      delete ctx.state.localVars[CHOICE_VAR];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CHOICE_REQUEST,
        target: atom.target,
        prompt: {
          type: 'useCard',
          title: `雌雄双股剑:弃置一张手牌,或放弃(令 ${self.name} 摸一张牌)`,
          cardFilter: {
            filter: () => true,
            candidates: target.hand.slice(),
            min: 1,
            max: 1,
          },
        },
        timeout: 15,
      });
      const discardId = ctx.state.localVars[CHOICE_VAR] as string | undefined | null;
      delete ctx.state.localVars[CHOICE_VAR];
      if (typeof discardId === 'string' && target.hand.includes(discardId)) {
        await applyAtom(ctx.state, { type: '弃置', player: atom.target, cardIds: [discardId] });
      } else {
        // 未提交/超时/无效 → owner 摸一张牌
        await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      }
    },
  );
  unloaders.push(hookUnloader);

  return () => {
    for (const fn of unloaders) fn();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '雌雄双股剑',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '雌雄双股剑:是否发动?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
