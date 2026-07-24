// 界连环(界庞统·主动技):你可以将一张梅花手牌当【铁索连环】使用或重铸。
//   你使用【铁索连环】可以多指定一个目标(即至多 3 名角色)。
//
// OL 官方(hero)逐字:
//   "你可以将一张梅花牌当【铁索连环】使用或重铸。你使用【铁索连环】可以多指定一个目标。"
//
// 与标连环区别:
//   - 标版仅基础转化/重铸,铁索连环目标上限 2(由标版铁索连环.use 校验)。
//   - 界版新增"使用铁索连环可以多指定一个目标",目标上限 3。
//   - 独立界版技能文件,不修改标连环/标铁索连环。影子卡 id 键 '界连环'(与标连环隔离)。
//
// 模型(组合 action + 覆盖):
//   ① transform action(preceding,界连环.transform):梅花手牌 → 影子铁索连环。
//      前端组合:preceding=[界连环.transform] + 主 action=铁索连环.use。
//   ② recycle action(界连环.recycle):弃一张梅花手牌,摸一张牌(铁索连环的重铸效果)。
//   ③ use action(覆盖铁索连环.use,仅本座次):界版铁索连环结算,目标上限 3(标版 2)。
//      覆盖保证:界庞统以任何来源的【铁索连环】(界连环转化或实际铁索连环牌)均走界版结算。
//      其他座次的铁索连环仍走标版(由标铁索连环 card skill 注册)。
//
// 覆盖机制:铁索连环在 DEFAULT_SKILLS 中,先实例化标版铁索连环.use;界连环.onInit 后实例化,
//   registerAction('铁索连环', ownerId, 'use', ...) 覆盖标版注册(state-bound 注册表 Map.set 覆盖)。
//   "你使用【铁索连环】可以多指定一个目标" 为角色锁定属性,凡本座次使用铁索连环均走界版,
//   符合官方语义。
//
// 模式参考:标连环.ts(转化/重铸)、界火计.ts(覆盖 DEFAULT_SKILLS 中 card skill 的 use)。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { setChain } from '../face-down';
import { registerAction, hasBlockingPending, validateUseCard } from '../skill';
import { 询问抵消 } from '../无懈可击';
import { defaultPlayActive } from '../action-active';

const CHAIN_MARK = 'chained';

/** 影子卡 id:${原id}#界连环(与标连环 ${原id}#连环 隔离) */
function shadowIdOf(cardId: string): string {
  return `${cardId}#界连环`;
}

/** 界庞统使用铁索连环的目标上限(标版 2,界版 +1 = 3) */
const MAX_TARGETS = 3;

function isChained(state: GameState, idx: number): boolean {
  return state.players[idx]?.marks.some((m) => m.id === CHAIN_MARK) ?? false;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界连环',
    description:
      '你可以将一张梅花牌当【铁索连环】使用或重铸;你使用【铁索连环】可以多指定一个目标(至多3名)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── recycle:弃一张梅花手牌,摸一张牌(铁索连环的重铸效果)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'recycle',
    (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isClub = !!card && card.suit === '♣';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && isClub;
      return ok ? null : '现在不能重铸(需出牌阶段、手中梅花牌)';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      await pushFrame(state, '界连环', from, { ...params });
      await applyAtom(state, { type: '弃置', player: from, cardIds: [cardId] });
      await applyAtom(state, { type: '摸牌', player: from, count: 1 });
      await popFrame(state);
    },
  );

  // ── transform:梅花手牌 → 影子"铁索连环"(作为 preceding,主 action=铁索连环.use) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isClub = !!card && card.suit === '♣';
      if (!selfAlive) return '你已死亡';
      if (!cardIdOk || !cardInHand) return '牌不在手牌中';
      if (!isClub) return '只能将梅花牌当铁索连环';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '铁索连环',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete state.cardMap[sId];
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );

  // ─── use action:覆盖标版铁索连环.use,本座次走界版结算(目标上限 3) ───
  // 铁索连环在 DEFAULT_SKILLS 中先实例化标版铁索连环.use;此处 registerAction 覆盖之(同 key 覆盖)。
  // 仅影响本座次(界庞统),其他座次的铁索连环仍走标版。
  // 与标版唯一差异:targets.length 上限由 2 提升至 3(官方"多指定一个目标")。
  registerAction(
    state,
    '铁索连环',
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const base = validateUseCard(state, ownerId, params, { cardName: '铁索连环' });
      if (base) return base;
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length < 1 || targets.length > MAX_TARGETS)
        return `需选择一至${MAX_TARGETS}名角色`;
      for (const t of targets) {
        if (!state.players[t]?.alive) return '目标不合法';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const targets = params.targets as number[];
      await pushFrame(state, '铁索连环', from, { ...params });
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      try {
        const cancelled = await 询问抵消(state, { cardName: '无懈可击', broadcast: true }, from, from);
        if (!cancelled) {
          for (const t of targets) {
            const chained = isChained(state, t);
            await setChain(state, t, !chained);
          }
        }
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        if (frameCards(state).includes(cardId)) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        await popFrame(state);
      }
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('recycle', {
    label: '界连环·重铸',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '界连环:弃一张梅花手牌,摸一张牌',
      cardFilter: { filter: (c: Card) => c.suit === '♣', min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      const hasClub = p.hand?.some((c) => c.suit === '♣') ?? false;
      return hasClub;
    },
  });
  api.defineAction('transform', {
    label: '界连环',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '界连环:将一张梅花手牌当铁索连环使用(至多3名目标)',
      cardFilter: { filter: (c: Card) => c.suit === '♣', min: 1, max: 1 },
      // 界版目标上限 3(标版铁索连环 2)
      targetFilter: { min: 1, max: MAX_TARGETS },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return p.hand?.some((c) => c.suit === '♣') ?? false;
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
