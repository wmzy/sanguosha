// 闪电(延时锦囊,可传递):出牌阶段对自己使用,放进自己判定区。
//   判定阶段:
//     ♠2~9(黑桃 2 到 9) → 受到 3 点无来源雷电伤害,闪电置入弃牌堆。
//     其他结果 → 无效,闪电传递给下家(下家的判定区)。
//   传递规则:按座次顺序找到下一个判定区没有 闪电 的存活玩家。
// 无来源伤害用 source: TARGET_SYSTEM 约定(系统惯例,见 造成伤害 atom)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, hasBlockingPending, type SkillModule } from '../skill'
import { askWuxie } from '../wuxie';
import { TARGET_SYSTEM } from '../types';

const TRICK_NAME = '闪电';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: TRICK_NAME, description: '延时锦囊:判定黑桃2-9则受3点雷电伤害,否则传给下家' };
}

/** 判定结果是否触发:黑桃 2~9 */
function isLightningHit(card: Card): boolean {
  if (card.suit !== '♠') return false;
  const rank = card.rank;
  const n = rank === 'A' ? 1 : rank === 'J' ? 11 : rank === 'Q' ? 12 : rank === 'K' ? 13 : parseInt(rank, 10);
  return n >= 2 && n <= 9;
}

/** 找下一个判定区没有闪电的存活玩家(从 current 之后按座次环形搜索) */
function findNextRecipient(state: GameState, current: number): number | null {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (current + i) % n;
    const p = state.players[idx];
    if (!p.alive) continue;
    if (p.pendingTricks.some(t => t.name === TRICK_NAME)) continue;
    return idx;
  }
  return null;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // ─── use action:对自己判定区放置延时锦囊 ────────────────────
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      const cardInHand = !!self?.hand.includes(params.cardId);
      const cardNameOk = state.cardMap[params.cardId]?.name === TRICK_NAME;
      // 闪电对自己使用;若自己判定区已有闪电则不可重复放置
      const notAlready = !self?.pendingTricks.some(t => t.name === TRICK_NAME);
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && notAlready;
      return ok ? null : '闪电使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      // 延时锦囊:使用时仅放置到判定区,无懈可击问询延迟到判定阶段判定前
      pushFrame(state, TRICK_NAME, from, { ...params });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      const trickCard = state.cardMap[cardId];
      const pendingCard: Card = trickCard ?? {
        id: cardId,
        name: TRICK_NAME,
        suit: '♠',
        rank: 'A',
        type: '锦囊牌',
      };
      await applyAtom(state, {
        type: '添加延时锦囊',
        player: from,
        trick: { name: TRICK_NAME, source: from, card: pendingCard },
      });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    });

  // ─── 判定阶段:有 闪电 → 先问无懈可击,未被抵消才触发判定 ────
  registerBeforeHook(skill.id, ownerId, '阶段开始', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '判定') return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    if (!self.pendingTricks.some(t => t.name === TRICK_NAME)) return;
    if (ctx.state.zones.deck.length === 0) return;

    // 无懈可击问询(延时锦囊的生效时机是判定前,故在此询问;抵消整个延时锦囊)
    try {
      const cancelled = await askWuxie(ctx.state, ownerId);
      if (cancelled) {
        // 被无懈抵消:移除延时锦囊,跳过判定
        await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: TRICK_NAME });
        return;
      }
      await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: TRICK_NAME });
    } finally {
      // askWuxie 内部已清理 localVars
    }
  });

  // ─── 判定 after:读判定牌花色+点数,执行效果 ──────────────
  registerAfterHook(skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.judgeType !== TRICK_NAME) return;
    if (atom.player !== ownerId) return;

    const self = ctx.state.players[ownerId];
    if (!self) return;
    if (!self.pendingTricks.some(t => t.name === TRICK_NAME)) return;

    // 读判定牌(在判定 atom.afterHooks 把它移入弃牌堆之前)
    const processing = ctx.state.zones.processing;
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 保留原 trick 条目引用(实体卡)——传递时复用同一张卡,不丢失实体
    const trickEntry = self.pendingTricks.find(t => t.name === TRICK_NAME);
    const lightningCard: Card = trickEntry?.card ?? judgeCard;

    if (isLightningHit(judgeCard)) {
      // 黑桃 2-9:受到 3 点无来源雷电伤害 + 移除闪电(进弃牌堆)
      await applyAtom(ctx.state, { type: '造成伤害', target: ownerId, amount: 3, source: TARGET_SYSTEM });
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: TRICK_NAME });
    } else {
      // 其他:移除当前玩家闪电,传递给下家(无下家可接时,闪电消失进弃牌堆)
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: TRICK_NAME });
      const next = findNextRecipient(ctx.state, ownerId);
      if (next !== null) {
        await applyAtom(ctx.state, {
          type: '添加延时锦囊',
          player: next,
          trick: { name: TRICK_NAME, source: ownerId, card: lightningCard },
        });
      }
    }
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: TRICK_NAME,
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: TRICK_NAME,
      cardFilter: { filter: (c) => c.name === TRICK_NAME, min: 1, max: 1 },
    },
  });
}
