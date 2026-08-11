// 往烈(陈到·蜀·被动技,OL hero/409 官方逐字):
//   你出牌阶段使用的首张牌无距离限制。当你于出牌阶段使用基本牌或普通锦囊牌时,
//   你可以令此牌不能被响应,然后你本阶段不能再使用牌。
//
// 效果拆分:
//   ① 首张牌无距离限制(被动,始终生效)
//   ② 使用基本牌/普通锦囊时可选令其不能被响应(可选,触发后本阶段禁出牌)
//
// ① 首张牌无距离限制:
//   - registerDistanceExemptor:owner 出牌阶段且尚未用牌时 → from→to 视为距离 1
//     (覆盖杀的 inAttackRange + 顺手牵羊/兵粮寸断的 effectiveDistance≤1)
//   - 使用时 after-hook:owner 出牌阶段使用的每张牌都标记 turn.vars[首张已用]=true
//     (在 validate 之后、settlement 之前写入,使豁免器仅对首张牌 validate 生效)
//
// ② 不可响应 + 禁出牌:
//   - 使用时 after-hook(仅 基本牌/普通锦囊):询问是否发动
//   - 发动 → localVars[不可响应]=cardId + turn.vars[禁出牌]=ownerId
//   - before-hook on 询问闪:cancel(镜像诈降红杀不可抵消)→ 目标无法出闪
//   - before-hook on 请求回应(无懈可击):cancel → 无人可出无懈
//   - 使用结算结束后 after-hook:清除 localVars[不可响应]
//   - isCardBanned(validate.ts)检查 turn.vars[禁出牌] → 阻止后续出牌
//
// turn.vars 在「回合结束」atom 自动清空 → 首张已用/禁出牌效果每回合重置。
import type { Card, FrontendAPI, GameState, HookResult, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';
import { registerDistanceExemptor } from '../rules/distance';
import type { SkillModule } from '../types';

/** turn.vars:本回合首张牌是否已使用(首张牌无距离限制的开关)。 */
const FIRST_USED_VAR = '往烈/首张已用';
/** turn.vars:发动不可响应后,本阶段不能再使用牌(值为被禁玩家座次)。 */
const BAN_VAR = '往烈/禁出牌';
/** localVars:当前不可响应的牌 id(使用结算结束后清除)。 */
const UNRESPONDABLE_VAR = '往烈/不可响应';
/** 询问 requestType:是否发动往烈。 */
const CHOOSE_RT = '往烈/choose';
/** localVars:玩家是否选择发动(choice=true=发动)。 */
const CHOICE_KEY = '往烈/choice';

/** 判断牌是否为基本牌或普通锦囊牌(延时/响应锦囊排除)。 */
function isBasicOrNormalTrick(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.type === '基本牌') return true;
  return (
    card.type === '锦囊牌' &&
    card.trickSubtype !== '延时锦囊' &&
    card.trickSubtype !== '响应锦囊'
  );
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '往烈',
    description:
      '你出牌阶段使用的首张牌无距离限制;当你于出牌阶段使用基本牌或普通锦囊牌时,你可以令此牌不能被响应,然后你本阶段不能再使用牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── ① 距离豁免器:首张牌无距离限制 ──────────────────────
  //   owner 出牌阶段且首张牌尚未使用时,from→to 视为距离 1。
  //   registerDistanceExemptor 覆盖 effectiveDistance(杀+顺手牵羊+兵粮寸断)。
  const unloadDistExemptor = registerDistanceExemptor(
    state,
    ownerId,
    (st, from, _to) => {
      if (from !== ownerId) return false;
      if (st.currentPlayerIndex !== ownerId) return false;
      if (st.phase !== '出牌') return false;
      if (st.turn.vars[FIRST_USED_VAR]) return false;
      return true;
    },
  );

  // ─── respond:玩家在 往烈/choose 询问下的选择 ────────────
  const unloadRespond = registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CHOOSE_RT) return '当前不是往烈选择';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CHOICE_KEY] = params.choice === true;
    },
  );

  // ─── 使用时 after-hook:首张牌标记 + 询问是否发动不可响应 ───
  registerAfterHook(state, skill.id, ownerId, '使用时', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '使用时') return;
    if (atom.source !== ownerId) return;
    if (ctx.state.currentPlayerIndex !== ownerId) return;
    if (ctx.state.phase !== '出牌') return;

    // ① 标记首张牌已用(所有牌类型均计数)
    ctx.state.turn.vars[FIRST_USED_VAR] = true;

    // ② 仅基本牌/普通锦囊可发动不可响应
    const card = ctx.state.cardMap[atom.cardId];
    if (!isBasicOrNormalTrick(card)) return;

    // 询问是否发动
    delete ctx.state.localVars[CHOICE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动往烈,令此牌不能被响应,然后本阶段不能再使用牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });

    if (ctx.state.localVars[CHOICE_KEY] === true) {
      ctx.state.localVars[UNRESPONDABLE_VAR] = atom.cardId;
      ctx.state.turn.vars[BAN_VAR] = ownerId;
    }
    delete ctx.state.localVars[CHOICE_KEY];
  });

  // ─── before-hook on 询问闪:不可响应的杀 → cancel 询问闪 ──
  //   镜像诈降红杀不可抵消:cancel 询问闪 → 目标无法出闪 → 杀直接命中。
  const unloadBanDodge = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx): Promise<HookResult | void> => {
      const cardId = ctx.params?.cardId as string | undefined;
      if (!cardId) return;
      if (ctx.state.localVars[UNRESPONDABLE_VAR] !== cardId) return;
      return { kind: 'cancel' };
    },
  );

  // ─── before-hook on 请求回应(无懈可击):不可响应的锦囊 → cancel ──
  //   cancel 请求回应 → RESPONDED_KEY 保持 false → promptCancel 循环退出
  //   → 无人可出无懈 → 锦囊不被抵消。
  const unloadBanNullify = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '请求回应',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom as { requestType?: string };
      if (atom.requestType !== '无懈可击') return;
      const cardId = ctx.params?.cardId as string | undefined;
      if (!cardId) return;
      if (ctx.state.localVars[UNRESPONDABLE_VAR] !== cardId) return;
      return { kind: 'cancel' };
    },
  );

  // ─── 使用结算结束后 after-hook:清除不可响应标记 ──────────
  registerAfterHook(state, skill.id, ownerId, '使用结算结束后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '使用结算结束后') return;
    if (atom.source !== ownerId) return;
    if (ctx.state.localVars[UNRESPONDABLE_VAR] === atom.cardId) {
      delete ctx.state.localVars[UNRESPONDABLE_VAR];
    }
  });

  return () => {
    unloadDistExemptor();
    unloadRespond();
    unloadBanDodge();
    unloadBanNullify();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '往烈',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动往烈,令此牌不能被响应,然后本阶段不能再使用牌?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
