// 界鬼道(界张角·被动触发,OL 界限突破官方逐字):
//   当一张判定牌生效前,你可以用一张黑色牌替换之,若此黑色牌为黑桃2~9,你摸一张牌。
//
// 界限突破(相对标鬼道 src/engine/skills/鬼道.ts):
//   标鬼道:用一张黑色牌替换判定牌。
//   界鬼道:同上,**且若替换牌为黑桃2~9,额外摸一张牌**。
//
// 其余机制(registerJudgeModifier / respond action / frameCards 直接 mutate)与标版一致。
//
// 命名:文件名/loader key/character skill name 均为 '界鬼道';
//   内部 Skill.name = '鬼道'(OL 官方技能名,玩家可见)。
import type { AtomAfterContext, Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerJudgeModifier } from '../skill';

const SKILL_ID = '界鬼道';
const DISPLAY_NAME = '鬼道';
const REPLACE_RT = '界鬼道/replace';
const REPLACE_CARD_KEY = '界鬼道/replaceCard';

/** 判断一张牌是否为黑色(♠或♣) */
function isBlackCard(state: GameState, cardId: string): boolean {
  const card = state.cardMap[cardId];
  return !!card && card.color === '黑';
}

/** 判断一张牌的点数是否为 2~9 */
function isRank2to9(rank: string): boolean {
  const n =
    rank === 'A'
      ? 1
      : rank === 'J'
        ? 11
        : rank === 'Q'
          ? 12
          : rank === 'K'
            ? 13
            : parseInt(rank, 10);
  return !Number.isNaN(n) && n >= 2 && n <= 9;
}

/** 判断一张牌是否为黑桃2~9(触发界鬼道摸牌效果) */
function isSpade2to9(card: Card | undefined): boolean {
  return !!card && card.suit === '♠' && isRank2to9(card.rank);
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '判定牌生效前,你可以用一张黑色牌替换之,若为黑桃2~9,你摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── respond:界张角选替换牌(或拒绝) ──────────────────────
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
      if (atom['requestType'] !== REPLACE_RT) return '当前不是界鬼道询问';
      // 选择替换:cardId 必须是黑色手牌;拒绝则无额外要求
      if (params.choice === true || params.confirmed === true) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张替换牌';
        if (!st.players[ownerId].hand.includes(cardId)) return '替换牌不在手牌中';
        if (!isBlackCard(st, cardId)) return '界鬼道只能用黑色牌替换';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const use = params.choice === true || params.confirmed === true;
      if (!use) {
        st.localVars[REPLACE_CARD_KEY] = null;
        return;
      }
      st.localVars[REPLACE_CARD_KEY] = params.cardId ?? null;
    },
  );

  // ─── 判定改判钩子:翻开判定牌后询问是否用黑色牌替换 ────────────
  registerJudgeModifier(state, skill.id, ownerId, async (ctx: AtomAfterContext) => {
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
        title: '界鬼道:是否打出一张黑色牌代替判定牌?(黑桃2~9摸一张)',
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

    const replaceCard = ctx.state.cardMap[replaceCardId];

    // 交换判定牌(直接 mutate frameCards,同鬼才/天妒/标鬼道模式)
    const cur = frameCards(ctx.state);
    const lastIdx = cur.length - 1;
    if (lastIdx < 0) return;
    const originalJudgeId = cur[lastIdx];
    cur.splice(lastIdx, 1);
    ctx.state.zones.discardPile.push(originalJudgeId);
    me.hand = me.hand.filter((id) => id !== replaceCardId);
    cur.push(replaceCardId);

    // ── 界限突破新增:替换牌为黑桃2~9 → 摸一张牌 ──────────────
    if (isSpade2to9(replaceCard)) {
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '界鬼道:选择一张黑色牌代替判定牌(黑桃2~9摸一张)',
      cardFilter: { filter: (c) => c.color === '黑', min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
