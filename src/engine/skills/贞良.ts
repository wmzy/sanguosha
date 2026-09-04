// 贞良(卢植·群·主动技·转换技,OL hero/407 风林火山官方逐字):
//   "转换技,阳:出牌阶段限一次,你可以选择攻击范围内的一名其他角色,
//    然后弃置一张与'任'颜色相同的牌对其造成1点伤害。
//    阴:当你于回合外使用或打出的牌置入弃牌堆时,若此牌与'任'颜色相同,
//    你可以令一名角色摸一张牌。"
//
// 转换技状态:player.vars['贞良/态'] = '阳'(默认) | '阴',跨回合持久。
//   - 阳(主动 use):出牌阶段限一次。选攻击范围内一名其他角色 →
//     弃一张与任同色的牌 → 对其造成 1 点伤害。发动后翻为 阴。
//   - 阴(被动):回合外,卢植使用或打出的牌置入弃牌堆时,若与任同色,
//     可令一名角色摸一张牌。完整结算后翻为 阳。
//
// 关键点:
//   - 转换态经「回合用量」atom 投影 view.turnUsage['贞良/态'];无 /usedThisTurn 后缀,
//     state.vars 中跨回合持久,但 view.turnUsage 在「回合结束」整体清空,故在拥有者
//     「回合开始」after-hook 重新同步一次。
//   - 阳限一次:'贞良/usedThisTurn'(后缀约定,回合结束自动清空)。
//   - "使用或打出"覆盖:使用(杀/桃/锦囊,经 runUseFlow)与打出(闪/无懈经 runUseFlow;
//     杀对南蛮/决斗经 runPlayFlow)。用 使用时 + 打出牌时 两个 after-hook 记录
//     卢植本回合使用/打出的牌 id 及颜色(于影子卡被弃牌堆替换前记录颜色),
//     再由 移动牌(处理区→弃牌堆)after-hook 触发阴判定。
//   - "置入弃牌堆"= 移动牌 from.zone='处理区' && to.zone='弃牌堆'(巨象同款判定)。
//   - 颜色用 card.color(红/黑);无色(多卡转化合成)永不与任(红/黑)同色 → 不触发。
//   - 一个 respond action 按 requestType 分支(阴确认 / 阴选目标)。
import type { FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import type { Color, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { runDamageFlow } from '../flows/damage';
import { inAttackRange } from '../rules/distance';
import { usedThisTurn, markOncePerTurn } from '../rules/once-per-turn';
import { defaultPlayActive } from '../rules/action-active';
import { viewCanAttack } from '../rules/viewDistance';
import { registerAction, registerAfterHook, hasBlockingPending } from '../core/skill';
import { REN_MARK_ID, getRenColor } from './明任';

const SKILL_ID = '贞良';
/** 转换态 state key(跨回合持久,无 /usedThisTurn 后缀)。 */
const STATE_KEY = '贞良/态';
/** 转换态 view 同步 key(经 回合用量 atom 投影 turnUsage)。 */
const STATE_VIEW_KEY = '贞良/态';

const YIN_CONFIRM_RT = '贞良/阴/confirm';
const YIN_TARGET_RT = '贞良/阴/选目标';
const YIN_CONFIRMED_KEY = '贞良/阴/confirmed';
const YIN_TARGET_KEY = '贞良/阴/目标';
/** localVars:卢植使用/打出的牌 id → 颜色(供 移动牌 触发时查色)。 */
const USED_COLORS_KEY = '贞良/阴/usedColors';

type ColorMap = Record<string, Color>;

function getState(state: GameState, ownerId: number): '阳' | '阴' {
  return state.players[ownerId]?.vars[STATE_KEY] === '阴' ? '阴' : '阳';
}

async function syncStateView(state: GameState, ownerId: number): Promise<void> {
  await applyAtom(state, {
    type: '回合用量',
    player: ownerId,
    key: STATE_VIEW_KEY,
    value: getState(state, ownerId),
  });
}

/** 记录卢植使用/打出的一张牌 id 及其颜色(若已记录则不覆盖)。 */
function recordUsedCard(state: GameState, cardId: string): void {
  const card = state.cardMap[cardId];
  if (!card) return;
  const color = card.color;
  if (color !== '红' && color !== '黑') return; // 无色牌不可能与任同色,不记录
  const map = (state.localVars[USED_COLORS_KEY] as ColorMap | undefined) ?? {};
  if (!(cardId in map)) map[cardId] = color;
  state.localVars[USED_COLORS_KEY] = map;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '转换技。阳:出牌阶段限一次,选攻击范围内一名其他角色,弃一张与"任"同色的牌对其造成1点伤害。阴:回合外使用或打出的牌置入弃牌堆时,若与"任"同色,可令一名角色摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:阴确认 / 阴选目标(单 action 按 requestType 分支)──
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
      if (rt === YIN_CONFIRM_RT) {
        return null; // confirm:接受 choice/confirmed
      }
      if (rt === YIN_TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t !== 'number') return '需要指定一名角色';
        if (!st.players[t]?.alive) return '目标不合法';
        return null;
      }
      return '当前不是贞良回应';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === YIN_CONFIRM_RT) {
        st.localVars[YIN_CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === YIN_TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[YIN_TARGET_KEY] = t;
      }
    },
  );

  // ── 阳:主动 use ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      const self = st.players[ownerId];
      if (!self) return 'player not found';
      if (!self.alive) return '你已死亡';
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过贞良';
      if (getState(st, ownerId) !== '阳') return '当前为阴状态,无法发动阳';
      // 须有任
      const renColor = getRenColor(st, ownerId);
      if (!renColor) return '没有"任",无法发动贞良';
      // 目标:攻击范围内一名其他存活角色
      const target = params.target;
      if (typeof target !== 'number') return '需要指定目标';
      if (target === ownerId) return '不能对自己发动贞良';
      if (!st.players[target]?.alive) return '目标不合法';
      if (!inAttackRange(st, ownerId, target)) return '目标不在攻击范围内';
      // 弃牌:一张与任同色的手牌
      const cardId = params.cardId;
      if (typeof cardId !== 'string') return '需要选择一张牌';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = st.cardMap[cardId];
      if (card?.color !== renColor) return '必须弃置一张与"任"颜色相同的牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const target = params.target as number;
      const cardId = params.cardId as string;

      // 限一次 + 翻转为阴(同步写 vars,防 dispatch 重入)
      await markOncePerTurn(st, from, SKILL_ID);
      st.players[from].vars[STATE_KEY] = '阴';
      await syncStateView(st, from);

      await pushFrame(st, `${SKILL_ID}(阳)`, from, { target, cardId });

      // 弃置一张与任同色的牌
      if (st.players[from].hand.includes(cardId)) {
        await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId] });
      }

      // 对目标造成 1 点伤害(来源为发动者,经完整伤害流程,可被防具等减伤)
      if (st.players[target]?.alive) {
        await runDamageFlow(st, from, target, 1);
      }

      await popFrame(st);
    },
  );

  // ── 使用时 after-hook:记录卢植使用的牌(覆盖 杀/桃/锦囊/闪/无懈 等)──
  registerAfterHook(state, skill.id, ownerId, '使用时', async (ctx) => {
    const atom = ctx.atom as { type: string; source?: number; cardId?: string };
    if (atom.type !== '使用时') return;
    if (atom.source !== ownerId) return;
    if (!atom.cardId) return;
    recordUsedCard(ctx.state, atom.cardId);
  });

  // ── 打出牌时 after-hook:记录卢植打出的牌(覆盖 杀 对南蛮/决斗 的打出)──
  registerAfterHook(state, skill.id, ownerId, '打出牌时', async (ctx) => {
    const atom = ctx.atom as { type: string; player?: number; cardId?: string };
    if (atom.type !== '打出牌时') return;
    if (atom.player !== ownerId) return;
    if (!atom.cardId) return;
    recordUsedCard(ctx.state, atom.cardId);
  });

  // ── 移动牌 after-hook:使用/打出的牌置入弃牌堆时触发阴判定 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom as {
      type: string;
      cardId?: string;
      from?: { zone?: string };
      to?: { zone?: string };
    };
    if (atom.type !== '移动牌') return;
    if (!atom.cardId) return;
    if (atom.from?.zone !== '处理区') return;
    if (atom.to?.zone !== '弃牌堆') return;

    const st = ctx.state;
    const map = st.localVars[USED_COLORS_KEY] as ColorMap | undefined;
    if (!map || !(atom.cardId in map)) return;
    const usedColor = map[atom.cardId];
    // 无论是否触发阴,该牌已入弃牌堆,清除记录防重复/误判
    delete map[atom.cardId];

    // 必须阴态 + 卢植存活 + 回合外
    if (getState(st, ownerId) !== '阴') return;
    if (!st.players[ownerId]?.alive) return;
    if (st.currentPlayerIndex === ownerId) return; // 仅回合外

    // 此牌须与任同色
    const renColor = getRenColor(st, ownerId);
    if (!renColor || usedColor !== renColor) return;

    // 询问是否发动
    delete st.localVars[YIN_CONFIRMED_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: YIN_CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '贞良(阴):是否令一名角色摸一张牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!st.localVars[YIN_CONFIRMED_KEY]) return; // 不发动 → 不翻转
    delete st.localVars[YIN_CONFIRMED_KEY];

    // 选择摸牌角色(任意存活角色,含自己)
    delete st.localVars[YIN_TARGET_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: YIN_TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '贞良(阴):选择一名角色摸一张牌',
        min: 1,
        max: 1,
        candidates: st.players.filter((p) => p.alive).map((p) => p.index),
        filter: (_view: GameView, t: number) => !!st.players[t]?.alive,
      },
      timeout: 20,
    });
    const chosen = st.localVars[YIN_TARGET_KEY] as number | undefined;
    delete st.localVars[YIN_TARGET_KEY];
    if (typeof chosen !== 'number' || !st.players[chosen]?.alive) return;

    // 令其摸一张牌
    await applyAtom(st, { type: '摸牌', player: chosen, count: 1 });

    // 完整结算:翻转为阳
    st.players[ownerId].vars[STATE_KEY] = '阳';
    await syncStateView(st, ownerId);
  });

  // ── 回合开始:重新同步转换态到 view(回合结束会整体清空 turnUsage)──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    if (ctx.atom.type !== '回合开始') return;
    if ((ctx.atom as { player?: number }).player !== ownerId) return;
    await syncStateView(ctx.state, ownerId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: SKILL_ID,
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '贞良(阳):弃一张与"任"同色的牌,对攻击范围内一名角色造成1点伤害',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 仅阳状态可发动(读 turnUsage;回合开始已重新同步)
      if (p.turnUsage?.[STATE_VIEW_KEY] === '阴') return false;
      // 本回合未用过
      if (p.turnUsage?.['贞良/usedThisTurn']) return false;
      // 须有任
      const renMark = p.marks.find((m) => m.id === REN_MARK_ID);
      const renCardId = (renMark?.payload as { cardId?: string } | undefined)?.cardId;
      if (typeof renCardId !== 'string') return false;
      const renColor = ctx.view.cardMap[renCardId]?.color;
      if (renColor !== '红' && renColor !== '黑') return false;
      // 须有与任同色的手牌
      const hasMatch = (p.hand ?? []).some((c) => c.color === renColor);
      if (!hasMatch) return false;
      // 须存在其他存活角色(攻击范围由 targetFilter 提示,此处只查有无其他存活角色)
      return ctx.view.players.some(
        (other) => other.index !== ctx.perspectiveIdx && other.alive,
      );
    },
  });

  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '贞良',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
