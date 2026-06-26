// 兵粮寸断(延时锦囊):出牌阶段对距离 1 以内的一名其他角色使用。
//   判定阶段:判定不为♣(梅花) → 跳过摸牌阶段;♣ → 无效弃置。
//   结构与乐不思蜀对称——差异:判定花色(♣ vs ♥),跳过阶段(摸牌 vs 出牌)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  Card,
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, hasBlockingPending, type SkillModule } from '../skill'
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';
import { askWuxie } from '../wuxie';

/** 跳过摸牌阶段的 tag 名 */
const SKIP_TAG = '兵粮寸断/跳过摸牌';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '兵粮寸断', description: '延时锦囊:判定非梅花则跳过摸牌阶段' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // ─── use action:对目标放置延时锦囊 ────────────────────────
  registerAction(state, skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'number') return 'target required';
      const cardInHand = !!self.hand.includes(params.cardId);
      const cardNameOk = state.cardMap[params.cardId]?.name === '兵粮寸断';
      const target = state.players[params.target];
      const targetAlive = target?.alive === true;
      const notSelf = params.target !== ownerId;
      // 兵粮寸断对距离 1 以内一名其他角色使用(与乐不思蜀一致)
      const inRange = effectiveDistance(state, ownerId, params.target as number) <= 1;
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && targetAlive && notSelf && inRange;
      return ok ? null : '兵粮寸断使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as number;
      await pushFrame(state, '兵粮寸断', from, { ...params });
      // 移牌到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 延时锦囊:使用时仅放置到判定区,无懈可击问询延迟到判定阶段判定前
      const trickCard = state.cardMap[cardId];
      const pendingCard: Card = trickCard ?? {
        id: cardId,
        name: '兵粮寸断',
        suit: '♣',
        rank: 'A',
        type: '锦囊牌',
      };
      await applyAtom(state, {
        type: '添加延时锦囊',
        player: target,
        trick: { name: '兵粮寸断', source: from, card: pendingCard },
      });
      // 移牌到弃牌堆(原使用卡)
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      await popFrame(state);
    });

  // ─── 判定阶段:有 兵粮寸断 → 先问无懈可击,未被抵消才触发判定 ───
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '判定') return;
    const self = ctx.state.players[ownerId];
    if (!self.pendingTricks.some(t => t.name === '兵粮寸断')) return;
    if (ctx.state.zones.deck.length === 0) return;

    // 无懈可击问询(延时锦囊的生效时机是判定前,故在此询问;抵消整个延时锦囊)
    try {
      const cancelled = await askWuxie(ctx.state, ownerId);
      if (cancelled) {
        // 被无懈抵消:移除延时锦囊,跳过判定
        await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '兵粮寸断' });
        return;
      }
      await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '兵粮寸断' });
    } finally {
      // askWuxie 内部已清理 localVars
    }
  });

  // ─── 判定 after:读判定牌花色,执行效果 ──────────────────────
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '兵粮寸断') return;
    if (atom.player !== ownerId) return;

    const self = ctx.state.players[ownerId];
    if (!self.pendingTricks.some(t => t.name === '兵粮寸断')) return;

    // 读判定牌:判定牌在处理区(afterHooks 才移到弃牌堆)
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    if (judgeCard.suit === '♣') {
      // 梅花:无效,只移除延时锦囊
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '兵粮寸断' });
    } else {
      // 其它花色:加跳过摸牌标签,移除延时锦囊
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_TAG });
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '兵粮寸断' });
    }
  });

  // ─── 摸牌阶段:有跳过标签 → 跳过摸牌阶段 ────────────────────
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '摸牌') return;
    const self = ctx.state.players[ownerId];
    if (!self.tags.includes(SKIP_TAG)) return;

    // 顺序很重要:
    //   1) 先去标签(否则 阶段结束 摸牌 之后回合管理阶段链会再次命中本 hook)
    //   2) 再触发 阶段结束 摸牌(让回合管理的 after hook 把阶段推进到 出牌)
    //   3) 返回 cancel → 当前 阶段开始 摸牌 atom 不 apply,state.phase 已是 出牌
    await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: SKIP_TAG });
    await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '摸牌' });
    return { kind: 'cancel' };
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '兵粮寸断',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '兵粮寸断',
      cardFilter: { filter: (c) => c.name === '兵粮寸断', min: 1, max: 1 },
      targetFilter: {
        min: 1, max: 1,
        filter: (view: GameView, t: number) => viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
      },
    },
  });
}
