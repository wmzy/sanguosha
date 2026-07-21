// 界强识(界张松·蜀·主动技,OL 界限突破官方逐字):
//   出牌阶段开始时,你可观看一名其他角色的手牌并展示其中一张牌,
//   然后你本阶段使用此类别的牌后可摸一张牌。
//
// 界限突破(相对标强识,标版未实现):
//   1. 标版:出牌阶段开始时,你可以展示一名其他角色一张手牌,然后当你本阶段使用与展示牌
//      类型相同的牌时,你可以摸一张牌。
//   2. 界版:"你可观看一名其他角色的手牌并展示其中一张牌" —— 界版"观看"强调可见全部
//      手牌后再选择展示哪张;然后"本阶段使用此类别的牌后可摸一张牌"。
//      "类别" = card.type('基本牌' / '锦囊牌' / '装备牌')。
//
// 实现要点:
//   - 触发:阶段开始(出牌) after-hook,atom.player===ownerId(自己出牌阶段开始)。
//   - 流程:询问发动 → 选目标(其他有手牌角色)→ 观看其手牌(pickProcessingCard 仅 owner
//     可见)→ 选一张展示( 展示 atom 广播)→ 记录 card.type 到 owner.vars。
//   - 移动牌 after-hook:owner 出牌阶段内,自己从手牌打出与所记类别相同的牌时
//     (from.zone='手牌' && from.player=owner && to.zone in {'处理区','弃牌堆'} && card.type===记),
//     询问是否摸一张牌(非锁定技,默认摸)。
//   - 阶段结束(出牌) after-hook:清除 owner.vars 中记录的类别(防泄漏到下一阶段)。
//   - 类别 = card.type:与官方"类别"(基本/锦囊/装备)对齐;转化技(武圣红牌当杀)的影子卡
//     type 为转化后类别(如'基本牌'),按转化后类别匹配。
//
// 命名:文件名/loader key/character skill name 均为 '界强识';内部 Skill.name='强识'。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const SKILL_ID = '界强识';
const DISPLAY_NAME = '强识';

/** owner.vars key:本阶段记录的"展示牌类别"('基本牌' | '锦囊牌' | '装备牌') */
const CATEGORY_KEY = `${SKILL_ID}/category`;
/** owner.vars key:本阶段展示的牌 cardId(信息用途,便于排查) */
const REVEALED_KEY = `${SKILL_ID}/revealedCard`;

/** requestType 常量 */
const CONFIRM_RT = `${SKILL_ID}/confirm`; // 是否发动
const TARGET_RT = `${SKILL_ID}/target`; // 选目标
const PICK_RT = `${SKILL_ID}/pick`; // 选一张展示
const DRAW_RT = `${SKILL_ID}/draw`; // 用同类牌后是否摸牌

/** localVars key */
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
const TARGET_KEY = `${SKILL_ID}/targetChoice`;
const PICK_KEY = `${SKILL_ID}/pickedCard`;
const DRAW_KEY = `${SKILL_ID}/drawConfirmed`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段开始时,你可观看一名其他角色的手牌并展示其中一张牌;本阶段你使用此类别的牌后可摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:按当前 pending requestType 分支 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as { requestType?: string }).requestType;

      if (rt === CONFIRM_RT || rt === DRAW_RT) {
        return null; // confirm:接受任意 choice
      }
      if (rt === TARGET_RT) {
        const t = params.target as number | undefined;
        if (typeof t !== 'number') return '需要指定一名目标';
        if (t === ownerId) return '不能观看自己的手牌';
        if (!st.players[t]?.alive) return '目标不合法';
        if (st.players[t].hand.length === 0) return '目标无手牌';
        return null;
      }
      if (rt === PICK_RT) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '需要选择一张牌展示';
        const target = st.localVars[TARGET_KEY] as number | undefined;
        if (typeof target !== 'number') return '目标未确定';
        if (!st.players[target]?.hand.includes(cardId)) return '该牌不在目标手牌中';
        return null;
      }
      return '当前不是强识询问';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === DRAW_RT) {
        st.localVars[DRAW_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === TARGET_RT) {
        st.localVars[TARGET_KEY] = params.target;
      } else if (rt === PICK_RT) {
        st.localVars[PICK_KEY] = params.cardId;
      }
    },
  );

  // ── 阶段开始(出牌) after-hook:owner 出牌阶段开始 → 询问发动 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;

    // 清理上一阶段的记录(防御性)
    delete st.players[ownerId].vars[CATEGORY_KEY];
    delete st.players[ownerId].vars[REVEALED_KEY];

    // 无其他有手牌的角色 → 不触发(无可观看目标)
    const hasTarget = st.players.some(
      (p, i) => i !== ownerId && p.alive && p.hand.length > 0,
    );
    if (!hasTarget) return;

    // 1) 是否发动强识(非锁定技,默认不发动)
    delete st.localVars[CONFIRM_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动强识?(观看一名其他角色的手牌并展示其中一张牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!st.localVars[CONFIRM_KEY]) {
      delete st.localVars[CONFIRM_KEY];
      return;
    }
    delete st.localVars[CONFIRM_KEY];

    await pushFrame(st, SKILL_ID, ownerId, {});

    // 2) 选目标(其他有手牌存活角色)
    delete st.localVars[TARGET_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '强识:选择一名其他角色(观看其手牌)',
        min: 1,
        max: 1,
        filter: (_view: GameView, t: number) =>
          t !== ownerId &&
          st.players[t]?.alive === true &&
          (st.players[t]?.hand.length ?? 0) > 0,
      },
      timeout: 20,
    });
    const target = st.localVars[TARGET_KEY] as number | undefined;
    // 不在此处 delete TARGET_KEY:PICK_RT 的 validate 仍需读取它校验牌在目标手牌中。
    // 会在本 hook 末尾(pick 完成后)统一清理。
    if (typeof target !== 'number' || target === ownerId) {
      delete st.localVars[TARGET_KEY];
      await popFrame(st);
      return;
    }
    if (!st.players[target]?.alive || st.players[target].hand.length === 0) {
      delete st.localVars[TARGET_KEY];
      await popFrame(st);
      return;
    }

    // 3) 观看目标手牌(pickProcessingCard 仅 owner 可见),选一张展示
    delete st.localVars[PICK_KEY];
    const handCards = st.players[target].hand.map((id) => {
      const c = st.cardMap[id];
      return {
        cardId: id,
        cardName: c?.name ?? '?',
        suit: c?.suit ?? '',
        rank: c?.rank ?? '',
      };
    });
    await applyAtom(st, {
      type: '请求回应',
      requestType: PICK_RT,
      target: ownerId,
      prompt: {
        type: 'pickProcessingCard',
        title: '强识:选择一张牌展示(本阶段使用此类别的牌可摸一张)',
        cards: handCards,
      },
      timeout: 30,
    });

    const pickedId = st.localVars[PICK_KEY] as string | undefined;
    delete st.localVars[PICK_KEY];
    delete st.localVars[TARGET_KEY]; // 清理:pick 完成,不再需要
    // 未选/超时/牌已离开 → 不展示,不记录类别
    if (typeof pickedId !== 'string' || !st.players[target].hand.includes(pickedId)) {
      await popFrame(st);
      return;
    }

    // 4) 展示此牌(全员可见)
    await applyAtom(st, { type: '展示', player: target, cardId: pickedId });

    // 5) 记录此牌的类别(供本阶段后续 移动牌 hook 比对)
    const card = st.cardMap[pickedId];
    if (card) {
      st.players[ownerId].vars[CATEGORY_KEY] = card.type;
      st.players[ownerId].vars[REVEALED_KEY] = pickedId;
    }

    await popFrame(st);
  });

  // ── 移动牌 after-hook:owner 出牌阶段内打出同类别的牌 → 询问摸一张 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx: AtomAfterContext) => {
    const st = ctx.state;
    // 仅在 owner 自己的出牌阶段
    if (st.currentPlayerIndex !== ownerId) return;
    if (st.phase !== '出牌') return;
    const category = st.players[ownerId]?.vars[CATEGORY_KEY];
    if (typeof category !== 'string') return;

    const atom = ctx.atom as {
      cardId?: string;
      from?: { zone?: string; player?: number };
      to?: { zone?: string };
    };
    if (!atom.cardId) return;
    if (atom.from?.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    if (!atom.to) return;
    if (atom.to.zone !== '处理区' && atom.to.zone !== '弃牌堆') return;

    const card = st.cardMap[atom.cardId];
    if (!card) return;
    if (card.type !== category) return;
    if (!st.players[ownerId]?.alive) return;

    // 询问是否摸一张牌(非锁定技,默认摸)
    delete st.localVars[DRAW_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: DRAW_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '强识:是否摸一张牌?(本阶段使用同类别的牌)',
        confirmLabel: '摸牌',
        cancelLabel: '不摸',
      },
      defaultChoice: true,
      timeout: 15,
    });
    if (!st.localVars[DRAW_KEY]) {
      delete st.localVars[DRAW_KEY];
      return;
    }
    delete st.localVars[DRAW_KEY];
    await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
  });

  // ── 阶段结束(出牌) after-hook:清除本阶段类别记录 ──
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段结束') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    const st = ctx.state;
    delete st.players[ownerId]?.vars[CATEGORY_KEY];
    delete st.players[ownerId]?.vars[REVEALED_KEY];
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动强识?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
