// 酒(基本牌,军争篇新增)——两种使用方法:
//   方法Ⅰ(use):出牌阶段对自己使用,本回合下一张杀的伤害 +1。
//   方法Ⅱ(respond):濒死时使用,回复 1 点体力(等同桃)。
//
// 方法Ⅱ的增伤效果通过 before hook(造成伤害)消费 mark 实现。
import type { AtomBeforeContext, FrontendAPI, GameState, HookResult, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '酒', description: '出牌阶段对自己使用,本回合下一张杀的伤害+1' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 手牌 + 牌名 + 目标合法
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardIdOk = typeof params.cardId === 'string';
      const cardInHand = cardIdOk && self?.hand.includes(params.cardId as string);
      const cardNameOk = cardIdOk && state.cardMap[params.cardId as string]?.name === '酒';
      // 酒对自己使用:无 target/targets 时默认给自己
      const rawTarget = (params.target ?? (params.targets as number[] | undefined)?.[0]) as number | undefined;
      const targetSelf = rawTarget === undefined || rawTarget === ownerId;
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && targetSelf;
      return ok ? null : '现在不能使用酒';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      pushFrame(state, '酒', from, { ...params });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      await applyAtom(state, {
        type: '加标记',
        player: from,
        mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
      });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    },
  );

  // respond:濒死时酒当桃用
  registerAction(skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '桃/求桃') return '当前不是求桃';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (card.name !== '酒') return '只能用酒救援';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: ownerId }, to: { zone: '弃牌堆' } });
      state.localVars['求桃/已救'] = true;
    },
  );

  // before hook:造成伤害时消费 mark,增伤 +1
  registerBeforeHook(skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { source?: number; amount?: number; type: string };
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const hasMark = self.marks.some(m => m.id === '酒/nextKillDamageBonus');
    if (!hasMark) return;
    await applyAtom(ctx.state, { type: '去标记', player: ownerId, markId: '酒/nextKillDamageBonus' });
    return { kind: 'modify', atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom };
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '酒',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '使用酒',
      cardFilter: { filter: (c) => c.name === '酒', min: 1, max: 1 },
    },
  });
  api.defineAction('respond', {
    label: '出酒',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '出酒救援',
      cardFilter: { filter: (c) => c.name === '酒', min: 1, max: 1 },
    },
  });
}

