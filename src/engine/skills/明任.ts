// 明任(卢植·群·被动技,OL hero/407 风林火山官方逐字):
//   "游戏开始时,你摸两张牌,然后将你的一张手牌置于你的武将牌上,称为'任'。
//    结束阶段,你可以用手牌替换'任'。"
//
// 两段效果:
//   1. 游戏开始初始化:摸 2 张牌 → 选 1 张手牌置为"任"(弃置入弃牌堆 earmark + 加任标记)。
//   2. 结束阶段:可选用一张手牌替换"任"(去旧任标记 → 弃置新手牌 → 加新任标记)。
//
// "任"的存储:单个 mark,id='明任/任',payload.cardId 携带原牌 id。
//   物理牌经 弃置 入弃牌堆(earmark 在 mark,同 征荣"荣");cardMap[cardId] 仍可读颜色/花色。
//   贞良(阳/阴)通过 getRenCardId/getRenColor 读任的颜色。
//
// 关键点:
//   - 游戏开始初始化(化身/界巧变先例):'回合开始' after-hook,首次触发。
//     主公首回合开始 ≈ 游戏开始,所有座次的 明任 实例同步初始化。
//   - 任唯一:始终只有 1 张任,mark id 固定 '明任/任'(替换时先去后加)。
//   - 结束阶段 = phase '回合结束'(阶段开始 after-hook)。
//   - 一个 respond action 按 requestType 分支(confirm / 选牌)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import type { Color, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';

const SKILL_ID = '明任';
/** 任标记 id(单张,固定 id;替换时先 去标记 再 加标记)。 */
export const REN_MARK_ID = '明任/任';
/** 游戏开始初始化标记(localVars,per-owner,首次触发后置 true) */
const INIT_KEY = (ownerId: number) => `${SKILL_ID}/init/${ownerId}`;
/** 选牌回应 requestType(init 与结束阶段替换共用) */
const PLACE_RT = `${SKILL_ID}/选牌`;
/** 结束阶段替换确认 requestType */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** 选牌结果 localVars key */
const PLACE_KEY = `${SKILL_ID}/选牌结果`;
/** 替换确认结果 localVars key */
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;

/** 取玩家当前"任"对应的牌 id(mark.payload.cardId);无任返回 undefined。 */
export function getRenCardId(state: GameState, player: number): string | undefined {
  const mark = state.players[player]?.marks.find((m) => m.id === REN_MARK_ID);
  const cardId = (mark?.payload as { cardId?: string } | undefined)?.cardId;
  return typeof cardId === 'string' ? cardId : undefined;
}

/** 取玩家当前"任"牌的颜色;无任或牌已丢失返回 undefined。 */
export function getRenColor(state: GameState, player: number): Color | undefined {
  const cardId = getRenCardId(state, player);
  if (!cardId) return undefined;
  return state.cardMap[cardId]?.color;
}

/** 询问玩家选 1 张手牌置为"任",完成 弃置 + 加任标记。无手牌则跳过。 */
async function placeRenFromHand(state: GameState, player: number): Promise<void> {
  const self = state.players[player];
  if (!self?.alive || self.hand.length === 0) return;

  delete state.localVars[PLACE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: PLACE_RT,
    target: player,
    prompt: {
      type: 'useCard',
      title: '明任:选择一张手牌置为"任"',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
    timeout: 30,
  });
  const cardIds = state.localVars[PLACE_KEY] as string[] | undefined;
  delete state.localVars[PLACE_KEY];
  if (!Array.isArray(cardIds) || cardIds.length === 0) return;
  const cardId = cardIds[0];
  if (!self.hand.includes(cardId)) return;

  // 弃置(手牌→弃牌堆 earmark)+ 加任标记
  await applyAtom(state, { type: '弃置', player, cardIds: [cardId] });
  await applyAtom(state, {
    type: '加标记',
    player,
    mark: { id: REN_MARK_ID, scope: player, payload: { cardId } },
  });
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '游戏开始时摸两张牌并将一张手牌置为"任";结束阶段可用手牌替换"任"',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:选牌 / 替换确认(单 action 按 requestType 分支)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不需要回应';
      const rt = atom.requestType;
      if (rt === CONFIRM_RT) {
        return null; // confirm:接受 choice/confirmed
      }
      if (rt === PLACE_RT) {
        const ids = params.cardIds as string[] | undefined;
        if (!Array.isArray(ids) || ids.length === 0) return '需要选择一张牌';
        const self = st.players[ownerId];
        if (!ids.every((id) => self.hand.includes(id))) return '牌不在手牌中';
        return null;
      }
      return '当前不是明任回应';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PLACE_RT) {
        const ids = params.cardIds as string[] | undefined;
        if (Array.isArray(ids)) st.localVars[PLACE_KEY] = ids;
      }
    },
  );

  // ── 游戏开始初始化:'回合开始' after-hook,首次触发 ──
  //   摸 2 张 → 选 1 张手牌置为任。
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    const st = ctx.state;
    if (st.localVars[INIT_KEY(ownerId)]) return; // 已初始化
    if (!st.players[ownerId]?.alive) return;
    st.localVars[INIT_KEY(ownerId)] = true;

    // 摸两张牌
    await applyAtom(st, { type: '摸牌', player: ownerId, count: 2 });

    // 选一张手牌置为任
    await placeRenFromHand(st, ownerId);
  });

  // ── 结束阶段:可选用手牌替换任 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom as { type: string; phase?: string; player?: number };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '回合结束') return; // 结束阶段 = phase '回合结束'
    if (atom.player !== ownerId) return;
    const st = ctx.state;
    const self = st.players[ownerId];
    if (!self?.alive) return;
    // 无任或无手牌则无可替换
    if (!getRenCardId(st, ownerId)) return;
    if (self.hand.length === 0) return;

    // 询问是否替换
    delete st.localVars[CONFIRMED_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '明任:是否用手牌替换"任"?',
        confirmLabel: '替换',
        cancelLabel: '不替换',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!st.localVars[CONFIRMED_KEY]) return;
    delete st.localVars[CONFIRMED_KEY];

    // 选一张手牌作为新任
    delete st.localVars[PLACE_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: PLACE_RT,
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: '明任:选择一张手牌替换"任"',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      timeout: 30,
    });
    const cardIds = st.localVars[PLACE_KEY] as string[] | undefined;
    delete st.localVars[PLACE_KEY];
    if (!Array.isArray(cardIds) || cardIds.length === 0) return;
    const cardId = cardIds[0];
    if (!self.hand.includes(cardId)) return;

    // 去旧任 + 弃置新牌 + 加新任
    await applyAtom(st, { type: '去标记', player: ownerId, markId: REN_MARK_ID });
    await applyAtom(st, { type: '弃置', player: ownerId, cardIds: [cardId] });
    await applyAtom(st, {
      type: '加标记',
      player: ownerId,
      mark: { id: REN_MARK_ID, scope: ownerId, payload: { cardId } },
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '明任:选择一张手牌',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
