// 鬼道(张角·被动触发):当一名角色的判定牌生效前,你可以用一张黑色牌替换之。
//
// 与鬼才(司马懿)同构:挂「判定」atom 的 after hook,在判定牌翻开(判定.apply 完成)
// 后、判定效果(闪电/乐不思蜀/雷击等消费方)读取判定牌前询问张角是否替换。
//
// 与鬼才的差异:**仅限黑色牌**(♠或♣,即 color==='黑')替换;鬼才为任意手牌。
//
// 替换机制(同鬼才):直接 mutate frameCards —— 判定 atom 无现成 atom 承载"替换判定牌"
//   操作。把判定牌(frameCards 顶)移入弃牌堆,把黑色手牌压入 frameCards 顶作为新判定牌。
//   消费方(闪电/雷击)之后读到的是替换后的牌。
//
// 已知限制(同鬼才):hook 执行顺序 = 注册顺序(runAfterHooks 仅把系统级 hook 排末尾)。
//   故张角需在消费技能(闪电 等)之前实例化,即座次靠前。雷击(张角自身技能)读取判定
//   结果在 `await applyAtom(判定)` 之后(从弃牌堆顶读),鬼道在判定 after hook 内替换,
//   先于雷击读取,故"打闪→雷击→鬼道改判为黑桃"组合链成立。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const REPLACE_RT = '鬼道/replace';
const REPLACE_CARD_KEY = '鬼道/replaceCard';

/** 判断一张牌是否为黑色(♠或♣) */
function isBlackCard(state: GameState, cardId: string): boolean {
  const card = state.cardMap[cardId];
  return !!card && card.color === '黑';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '鬼道',
    description: '判定牌生效前,你可以用一张黑色牌替换之',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── respond:张角选替换牌(或拒绝) ──────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== REPLACE_RT) return '当前不是鬼道询问';
      // 选择替换:cardId 必须是黑色手牌;拒绝则无额外要求
      if (params.choice === true || params.confirmed === true) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张替换牌';
        if (!st.players[ownerId].hand.includes(cardId)) return '替换牌不在手牌中';
        if (!isBlackCard(st, cardId)) return '鬼道只能用黑色牌替换';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const use = params.choice === true || params.confirmed === true;
      if (!use) {
        st.localVars[REPLACE_CARD_KEY] = null;
        return;
      }
      st.localVars[REPLACE_CARD_KEY] = (params.cardId as string) ?? null;
    },
  );

  // ─── 判定 after hook:翻开判定牌后询问是否用黑色牌替换 ────────────
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '判定') return;

    const me = ctx.state.players[ownerId];
    if (!me?.alive) return;
    // 仅当有黑色手牌时才询问
    if (!me.hand.some((id) => isBlackCard(ctx.state, id))) return;

    // 当前判定牌(frameCards 顶)
    const cards = frameCards(ctx.state);
    if (cards.length === 0) return;

    // 询问是否替换
    delete ctx.state.localVars[REPLACE_CARD_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: REPLACE_RT,
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: '鬼道:是否打出一张黑色牌代替判定牌?',
        cardFilter: { filter: (c) => c.color === '黑', min: 1, max: 1 },
      },
      defaultChoice: false,
      timeout: 15,
    });

    const replaceCardId = ctx.state.localVars[REPLACE_CARD_KEY] as string | null | undefined;
    delete ctx.state.localVars[REPLACE_CARD_KEY];
    if (!replaceCardId) return; // 不替换

    // 二次校验:替换牌仍须在手中且为黑色
    if (!me.hand.includes(replaceCardId)) return;
    if (!isBlackCard(ctx.state, replaceCardId)) return;

    // 交换判定牌(直接 mutate frameCards,同鬼才/天妒模式,避免产生额外 ViewEvent
    //   导致 processedView 与 buildView 不对称)
    const cur = frameCards(ctx.state);
    const lastIdx = cur.length - 1;
    if (lastIdx < 0) return;
    const originalJudgeId = cur[lastIdx];
    cur.splice(lastIdx, 1);
    ctx.state.zones.discardPile.push(originalJudgeId);
    me.hand = me.hand.filter((id) => id !== replaceCardId);
    cur.push(replaceCardId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '鬼道',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '鬼道:选择一张黑色牌代替判定牌',
      cardFilter: { filter: (c) => c.color === '黑', min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
