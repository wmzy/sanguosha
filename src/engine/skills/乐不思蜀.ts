// 乐不思蜀(延时锦囊):出牌阶段对距离 1 以内的一名角色使用。
//   判定阶段:判定不为♥ → 跳过出牌阶段;♥ → 无效弃置。
//   判定牌走处理区,after hook 从处理区读花色,判定后进弃牌堆。
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
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule, validateUseCard } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';
import { askWuxie } from '../wuxie';

/** 跳过出牌阶段的 tag 名(实现为 mark id='tag:乐不思蜀/跳过出牌') */
const SKIP_TAG = '乐不思蜀/跳过出牌';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '乐不思蜀', description: '延时锦囊:判定非红桃则跳过出牌阶段' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // ─── use action:对目标放置延时锦囊 ────────────────────────
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '乐不思蜀' })
        ?? (() => {
          const t = params.target ?? (params.targets as number[] | undefined)?.[0] as number | undefined;
          return typeof t === 'number' && t !== ownerId && state.players[t]?.alive && effectiveDistance(state, ownerId, t) <= 1
            ? null : '目标不合法';
        })();
    }, async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as number;
      await pushFrame(state, '乐不思蜀', from, { ...params });
      // 移牌到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 添加延时锦囊到目标(用 cardMap 里的真卡;suit/rank 保留)
      const trickCard = state.cardMap[cardId];
      const pendingCard: Card = trickCard ?? {
        id: cardId,
        name: '乐不思蜀',
        suit: '♠',
        rank: 'A',
        type: '锦囊牌',
      };
      await applyAtom(state, {
        type: '添加延时锦囊',
        player: target,
        trick: { name: '乐不思蜀', source: from, card: pendingCard },
      });
      // 移牌到弃牌堆(原使用卡)
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      await popFrame(state);
    });

  // ─── 判定阶段:有 乐不思蜀 → 先问无懈可击,未被抵消才触发判定 ───
  registerBeforeHook(skill.id, ownerId, '阶段开始', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '判定') return;
    const self = ctx.state.players[ownerId];
    if (!self.pendingTricks.some(t => t.name === '乐不思蜀')) return;
    // 牌堆空:无法判定,跳过(规则允许直接弃置,但避免引擎崩;这里 no-op)
    if (ctx.state.zones.deck.length === 0) return;

    // 无懈可击问询(延时锦囊的生效时机是判定前,故在此询问;抵消整个延时锦囊)
    try {
      const cancelled = await askWuxie(ctx.state, ownerId);
      if (cancelled) {
        // 被无懈抵消:移除延时锦囊,跳过判定
        await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '乐不思蜀' });
        return;
      }
      // 触发判定:判定 atom 是事件标记,引擎会自动从牌堆翻一张到 judgeZone,
      // 然后在 after hook 中读顶牌花色决定效果。
      await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '乐不思蜀' });
    } finally {
      // askWuxie 内部已清理 localVars
    }
  });

  // ─── 判定 after:读判定牌花色,执行效果 ──────────────────────
  registerAfterHook(skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '乐不思蜀') return;
    if (atom.player !== ownerId) return;

    const self = ctx.state.players[ownerId];
    // 没有 pendingTrick → 不处理(可能已被 过河拆桥 拆掉)
    if (!self.pendingTricks.some(t => t.name === '乐不思蜀')) return;

    // 读判定牌:判定牌在处理区(afterHooks 才移到弃牌堆)
    const processing = ctx.state.zones.processing;
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    if (judgeCard.suit === '♥') {
      // 红桃:无效,只移除延时锦囊(规则:♥ 时乐不思蜀无效果并弃置)
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '乐不思蜀' });
    } else {
      // 其它花色:加跳过出牌标签,移除延时锦囊
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_TAG });
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '乐不思蜀' });
    }
  });

  // ─── 出牌阶段:有跳过标签 → 跳过出牌阶段 ────────────────────
  registerBeforeHook(skill.id, ownerId, '阶段开始', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '出牌') return;
    const self = ctx.state.players[ownerId];
    // 检查跳过标签(tags 数组)
    if (!self.tags.includes(SKIP_TAG)) return;

    // 顺序很重要:
    //   1) 先去标签(否则 阶段结束 出牌 之后回合管理阶段链会再次命中本 hook)
    //   2) 再触发 阶段结束 出牌(让回合管理的 after hook 把阶段推进到 弃牌)
    //   3) 返回 cancel → 当前 阶段开始 出牌 atom 不 apply,state.phase 已是 弃牌
    await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: SKIP_TAG });
    await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '出牌' });
    return { kind: 'cancel' };
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '乐不思蜀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '乐不思蜀',
      cardFilter: { filter: (c) => c.name === '乐不思蜀', min: 1, max: 1 },
      targetFilter: {
        min: 1, max: 1,
        // 距离≤1 检查:filter 仅为前端 UI 提示,后端 validate 独立校验
        filter: (view: GameView, t: number) => viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
      },
    },
  });
}
