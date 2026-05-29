import type { GameState, Effect, Condition, Card, TurnPhase } from '../shared/types';
import type { EffectExecContext, SkipFlags } from './types';
import { updatePlayer, getPlayer } from './state';
import { shuffle } from '../shared/deck';
import { createRng } from '../shared/rng';
import { performJudge } from './judge';

export { checkCondition };

export function executeEffect(
  game: GameState,
  effect: Effect,
  ctx: EffectExecContext,
): GameState {
  switch (effect.type) {
    case 'draw':
      return execDraw(game, ctx, resolveCount(effect.count, ctx));
    case 'damage':
      return execDamage(game, ctx, ctx.target, effect.amount ?? 1);
    case 'heal':
      return execHeal(game, ctx, effect.amount, effect.target);
    case 'discard':
      return execDiscard(game, ctx, effect);
    case 'gainCard':
      return execGainCard(game, ctx, effect);
    case 'skipPhase':
      return execSkipPhase(game, ctx._skipFlags, effect.phase);
    case 'skipDraw':
      return execSkipDraw(game, ctx._skipFlags);
    case 'judge':
      return execJudge(game, ctx, effect);
    case 'addPendingTrick':
      return execAddPendingTrick(game, ctx, effect.trickName, effect.target);
    case 'convert':
      return execConvert(game, ctx, effect);
    case 'redirect':
      return game;
    case 'giveCards':
      return execGiveCards(game, ctx, effect);
    case 'lookAtTopCards':
      return execLookAtTopCards(game, ctx, effect);
    case 'dealDamage':
      return execDealDamage(game, ctx, effect);
    case 'sequence':
      return effect.steps.reduce((s, step) => executeEffect(s, step, ctx), game);
    case 'conditional':
      return execConditional(game, effect, ctx);
    default:
      return game;
  }
}

function resolveCount(count: number | string, ctx: EffectExecContext): number {
  if (typeof count === 'number') return count;
  return ctx.amount ?? 1;
}

function ensureDeck(game: GameState, ctx: EffectExecContext): GameState {
  if (game.deck.length > 0) return game;
  if (game.discardPile.length === 0) return game;
  const shuffled = shuffle(game.discardPile, ctx.rng);
  return { ...game, deck: shuffled, discardPile: [] };
}

function execDraw(game: GameState, ctx: EffectExecContext, count: number): GameState {
  const state = ensureDeck(game, ctx);
  const available = Math.min(count, state.deck.length);
  if (available === 0) return state;
  const drawn = state.deck.slice(0, available);
  const player = getPlayer(state, ctx.player);
  return {
    ...updatePlayer(state, ctx.player, { hand: [...player.hand, ...drawn] }),
    deck: state.deck.slice(available),
  };
}

function execDamage(
  game: GameState,
  ctx: EffectExecContext,
  target: string | undefined,
  amount: number,
): GameState {
  if (!target) return game;
  const targetPlayer = getPlayer(game, target);
  return updatePlayer(game, target, {
    health: targetPlayer.health - amount,
  });
}

function execHeal(
  game: GameState,
  ctx: EffectExecContext,
  amount: number,
  target?: string,
): GameState {
  const healTarget = target ?? ctx.player;
  const player = getPlayer(game, healTarget);
  return updatePlayer(game, healTarget, {
    health: Math.min(player.health + amount, player.maxHealth),
  });
}

function execDiscard(
  game: GameState,
  ctx: EffectExecContext,
  effect: { source?: string; count: number | 'any'; target?: string },
): GameState {
  const discardTarget = effect.target ?? ctx.player;
  if (effect.target === 'selected') {
    const t = ctx.target;
    if (!t) return game;
    return discardFromPlayer(game, ctx, t, effect.count);
  }
  return discardFromPlayer(game, ctx, discardTarget, effect.count);
}

function discardFromPlayer(
  game: GameState,
  ctx: EffectExecContext,
  targetName: string,
  count: number | 'any',
): GameState {
  const target = getPlayer(game, targetName);
  if (target.hand.length === 0) return game;

  const discardCount = count === 'any' ? target.hand.length : Math.min(count, target.hand.length);
  const indices: number[] = [];
  const available = target.hand.length;
  while (indices.length < discardCount) {
    const idx = ctx.rng.nextInt(available);
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }

  const discarded = indices.map(i => target.hand[i]);
  const remaining = target.hand.filter((_, i) => !indices.includes(i));

  return {
    ...updatePlayer(game, targetName, { hand: remaining }),
    discardPile: [...game.discardPile, ...discarded],
  };
}

function execGainCard(
  game: GameState,
  ctx: EffectExecContext,
  effect: { from?: string; source?: string; count?: number },
): GameState {
  const source = effect.source;
  const count = effect.count ?? 1;

  if (source === 'damageSourceCard') {
    if (!ctx.damageSourceCard) return game;
    const player = getPlayer(game, ctx.player);
    return updatePlayer(game, ctx.player, {
      hand: [...player.hand, ctx.damageSourceCard],
    });
  }

  if (source === 'attacker') {
    if (!ctx.attacker) return game;
    return gainRandomCardFromPlayer(game, ctx, ctx.attacker, count);
  }

  if (source === 'judgeCard') {
    if (!ctx._judgeCard) return game;
    const player = getPlayer(game, ctx.player);
    return updatePlayer(game, ctx.player, {
      hand: [...player.hand, ctx._judgeCard],
    });
  }

  if (source === 'otherPlayers') {
    return gainFromOtherPlayers(game, ctx, count);
  }

  if (source === 'selected') {
    if (!ctx.target) return game;
    return gainRandomCardFromPlayer(game, ctx, ctx.target, count);
  }

  if (effect.from === 'discard' && game.discardPile.length > 0) {
    const card = game.discardPile[game.discardPile.length - 1];
    const player = getPlayer(game, ctx.player);
    return {
      ...updatePlayer(game, ctx.player, { hand: [...player.hand, card] }),
      discardPile: game.discardPile.slice(0, -1),
    };
  }

  const state = ensureDeck(game, ctx);
  if (state.deck.length === 0) return state;
  const card = state.deck[0];
  const player = getPlayer(state, ctx.player);
  return {
    ...updatePlayer(state, ctx.player, { hand: [...player.hand, card] }),
    deck: state.deck.slice(1),
  };
}

function gainRandomCardFromPlayer(
  game: GameState,
  ctx: EffectExecContext,
  fromName: string,
  count: number,
): GameState {
  const from = getPlayer(game, fromName);
  if (from.hand.length === 0) return game;
  const actual = Math.min(count, from.hand.length);
  const player = getPlayer(game, ctx.player);
  const gained: Card[] = [];
  let hand = [...from.hand];

  for (let i = 0; i < actual; i++) {
    const idx = ctx.rng.nextInt(hand.length);
    gained.push(hand[idx]);
    hand = hand.filter((_, ci) => ci !== idx);
  }

  let state = updatePlayer(game, fromName, { hand });
  state = updatePlayer(state, ctx.player, { hand: [...player.hand, ...gained] });
  return state;
}

function gainFromOtherPlayers(
  game: GameState,
  ctx: EffectExecContext,
  count: number,
): GameState {
  const others = game.players.filter(p => p.alive && p.name !== ctx.player && p.hand.length > 0);
  const targetCount = Math.min(count, others.length);
  const gained: Card[] = [];
  let state = game;

  for (let i = 0; i < targetCount; i++) {
    const target = others[i];
    const idx = ctx.rng.nextInt(target.hand.length);
    gained.push(target.hand[idx]);
    const currentTarget = getPlayer(state, target.name);
    state = updatePlayer(state, target.name, {
      hand: currentTarget.hand.filter((_, ci) => ci !== idx),
    });
  }

  const currentPlayer = getPlayer(state, ctx.player);
  return updatePlayer(state, ctx.player, {
    hand: [...currentPlayer.hand, ...gained],
  });
}

function execSkipPhase(game: GameState, flags: SkipFlags | undefined, phase: TurnPhase | undefined): GameState {
  if (flags && phase) {
    flags.phases.add(phase);
  }
  return game;
}

function execSkipDraw(game: GameState, flags: SkipFlags | undefined): GameState {
  if (flags) {
    flags.draw = true;
  }
  return game;
}

function execJudge(
  game: GameState,
  ctx: EffectExecContext,
  effect: {
    type: 'judge';
    condition?: string;
    expectedSuit?: string;
    repeatOnBlack?: boolean;
    redResult?: string;
    failEffect?: string;
    onSuccess?: Effect;
    onFail?: Effect;
  },
): GameState {
  let state = game;

  if (effect.repeatOnBlack) {
    while (true) {
      state = ensureDeck(state, ctx);
      if (state.deck.length === 0) break;
      const { game: newGame, card } = performJudge(state, ctx.rng);
      state = newGame;
      ctx._judgeCard = card;

      const isBlack = card.suit === '♠' || card.suit === '♣';
      if (!isBlack) {
        state = { ...state, discardPile: [...state.discardPile, card] };
        break;
      }
      if (effect.onSuccess) {
        state = executeEffect(state, effect.onSuccess, ctx);
      }
    }
    return state;
  }

  state = ensureDeck(state, ctx);
  if (state.deck.length === 0) return state;
  const { game: newGame, card } = performJudge(state, ctx.rng);
  state = newGame;
  ctx._judgeCard = card;
  state = { ...state, discardPile: [...state.discardPile, card] };

  const succeeded = !effect.expectedSuit || card.suit === effect.expectedSuit;

  if (succeeded && effect.onSuccess) {
    return executeEffect(state, effect.onSuccess, ctx);
  }
  if (!succeeded && effect.onFail) {
    return executeEffect(state, effect.onFail, ctx);
  }
  return state;
}

function execAddPendingTrick(
  game: GameState,
  ctx: EffectExecContext,
  trickName: string,
  target: string,
): GameState {
  const actualTarget = target === 'selected' ? ctx.target : (target === 'self' ? ctx.player : target);
  if (!actualTarget) return game;
  const trick = { name: trickName, source: ctx.player, card: ctx.card! };
  const player = getPlayer(game, actualTarget);
  return updatePlayer(game, actualTarget, {
    pendingTricks: [...(player.pendingTricks ?? []), trick],
  });
}

function execConvert(
  game: GameState,
  ctx: EffectExecContext,
  effect: { from: string; to: string },
): GameState {
  if (!ctx.card) return game;
  const converted: Card = {
    ...ctx.card,
    name: effect.to,
    _original: ctx.card,
    _conversion: effect.to,
  };
  const player = getPlayer(game, ctx.player);
  const idx = player.hand.findIndex(c => c.id === ctx.card!.id);
  if (idx === -1) return game;
  const newHand = [...player.hand];
  newHand[idx] = converted;
  return updatePlayer(game, ctx.player, { hand: newHand });
}

function execGiveCards(
  game: GameState,
  ctx: EffectExecContext,
  effect: { count: number | 'any'; target: string },
): GameState {
  if (!ctx.target) return game;
  const player = getPlayer(game, ctx.player);
  if (player.hand.length === 0) return game;
  const giveCount = effect.count === 'any' ? player.hand.length : Math.min(effect.count, player.hand.length);
  const given = player.hand.slice(0, giveCount);
  const remaining = player.hand.slice(giveCount);
  const target = getPlayer(game, ctx.target);
  let state = updatePlayer(game, ctx.player, { hand: remaining });
  state = updatePlayer(state, ctx.target, { hand: [...target.hand, ...given] });
  return state;
}

function execLookAtTopCards(
  game: GameState,
  _ctx: EffectExecContext,
  _effect: { count: number | string },
): GameState {
  return game;
}

function execDealDamage(
  game: GameState,
  ctx: EffectExecContext,
  effect: { amount?: number; target?: string; condition?: string; bonusDamage?: number },
): GameState {
  let damageAmount = effect.amount ?? 1;
  if (effect.condition && effect.bonusDamage && matchesDamageCondition(effect.condition, ctx.card)) {
    damageAmount += effect.bonusDamage;
  }
  const target = effect.target ?? ctx.target;
  return execDamage(game, ctx, target, damageAmount);
}

function matchesDamageCondition(condition: string, card?: Card): boolean {
  if (!card) return false;
  if (condition === '杀或决斗') return card.name === '杀' || card.name === '决斗';
  return card.name === condition;
}

function execConditional(
  game: GameState,
  effect: { condition: Condition; then: Effect; else?: Effect },
  ctx: EffectExecContext,
): GameState {
  const player = getPlayer(game, ctx.player);
  if (checkCondition(game, player, effect.condition, ctx)) {
    return executeEffect(game, effect.then, ctx);
  }
  if (effect.else) {
    return executeEffect(game, effect.else, ctx);
  }
  return game;
}

function checkCondition(
  game: GameState,
  player: import('../shared/types').Player,
  condition: Condition,
  ctx: EffectExecContext,
): boolean {
  if (condition.phase !== undefined && game.phase !== condition.phase) return false;

  if (condition.hasHandCards !== undefined) {
    if (condition.hasHandCards && player.hand.length === 0) return false;
    if (!condition.hasHandCards && player.hand.length > 0) return false;
  }

  if (condition.targetCard !== undefined) {
    if (ctx.card?.name !== condition.targetCard) return false;
  }

  const keys = Object.keys(condition);
  for (const key of keys) {
    if (key === 'phase' || key === 'hasHandCards' || key === 'cardsGivenThisPhase' || key === 'targetCard') continue;

    if (key === 'cardType' && condition.cardType) {
      if (!ctx.card) return false;
      if (condition.cardType === '判定牌' && ctx.card.type !== '锦囊牌') return false;
    }
  }

  return true;
}

// 便捷函数，返回统一的结果格式
export interface EffectResult {
  success: boolean;
  state: GameState;
  message?: string;
}

function makeCtx(player: string, target?: string): EffectExecContext {
  return {
    player,
    target,
    rng: createRng(Date.now()),
  };
}

export function playKill(game: GameState, player: string, target: string): EffectResult {
  if (player === target) {
    return { success: false, state: game, message: '不能对自己使用杀' };
  }
  try {
    const ctx = makeCtx(player, target);
    const state = executeEffect(game, { type: 'damage', amount: 1 }, ctx);
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playPeach(game: GameState, player: string): EffectResult {
  const p = getPlayer(game, player);
  if (p.health >= p.maxHealth) {
    return { success: false, state: game, message: '体力已满' };
  }
  try {
    const ctx = makeCtx(player);
    const state = executeEffect(game, { type: 'heal', amount: 1 }, ctx);
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playDismantle(game: GameState, player: string, target: string): EffectResult {
  if (player === target) {
    return { success: false, state: game, message: '不能对自己使用' };
  }
  const t = getPlayer(game, target);
  if (t.hand.length === 0) {
    return { success: false, state: game, message: '目标没有手牌' };
  }
  try {
    const ctx = makeCtx(player, target);
    const state = executeEffect(game, { type: 'discard', count: 1, target: 'selected' }, ctx);
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playSteal(game: GameState, player: string, target: string): EffectResult {
  const t = getPlayer(game, target);
  if (t.hand.length === 0) {
    return { success: false, state: game, message: '目标没有牌' };
  }
  try {
    const ctx = makeCtx(player, target);
    const state = executeEffect(game, { type: 'gainCard', source: 'selected' }, ctx);
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playDrawTwo(game: GameState, player: string): EffectResult {
  if (game.deck.length < 2) {
    return { success: false, state: game, message: '牌堆不足' };
  }
  try {
    const ctx = makeCtx(player);
    const state = executeEffect(game, { type: 'draw', count: 2 }, ctx);
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playDuel(game: GameState, player: string, target: string): EffectResult {
  if (player === target) {
    return { success: false, state: game, message: '不能对自己使用' };
  }
  try {
    const ctx = makeCtx(player, target);
    const state = executeEffect(game, { type: 'damage', amount: 1 }, ctx);
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playArrowBarrage(game: GameState, player: string): EffectResult {
  try {
    const ctx = makeCtx(player);
    let state = game;
    for (const p of state.players) {
      if (p.alive && p.name !== player) {
        state = executeEffect(state, { type: 'damage', amount: 1 }, { ...ctx, target: p.name });
      }
    }
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playBarbarianInvasion(game: GameState, player: string): EffectResult {
  try {
    const ctx = makeCtx(player);
    let state = game;
    for (const p of state.players) {
      if (p.alive && p.name !== player) {
        state = executeEffect(state, { type: 'damage', amount: 1 }, { ...ctx, target: p.name });
      }
    }
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playPeachGarden(game: GameState, player: string): EffectResult {
  // 检查是否所有人都满血
  const allFull = game.players.filter(p => p.alive).every(p => p.health >= p.maxHealth);
  if (allFull) {
    return { success: false, state: game, message: '所有人都满血' };
  }
  try {
    const ctx = makeCtx(player);
    let state = game;
    for (const p of state.players) {
      if (p.alive && p.health < p.maxHealth) {
        state = executeEffect(state, { type: 'heal', amount: 1 }, { ...ctx, player: p.name });
      }
    }
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}

export function playAbundance(game: GameState, player: string): EffectResult {
  const aliveCount = game.players.filter(p => p.alive).length;
  if (game.deck.length < aliveCount) {
    return { success: false, state: game, message: '牌堆不足' };
  }
  try {
    const ctx = makeCtx(player);
    let state = game;
    for (const p of state.players) {
      if (p.alive) {
        state = executeEffect(state, { type: 'draw', count: 1 }, { ...ctx, player: p.name });
      }
    }
    return { success: true, state };
  } catch (e) {
    return { success: false, state: game, message: String(e) };
  }
}
