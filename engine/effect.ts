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
      return execRedirect(game, ctx, effect);
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
  if (count === 'sameAsDiscarded') return ctx._discardedCount ?? 0;
  if (count === 'alivePlayers') return ctx._aliveCount ?? 0;
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
  let discardTarget: string;
  if (effect.target === 'attacker') {
    if (!ctx.attacker) return game;
    discardTarget = ctx.attacker;
  } else if (effect.target === 'selected') {
    if (!ctx.target) return game;
    return discardFromPlayer(game, ctx, ctx.target, effect.count);
  } else {
    discardTarget = effect.target ?? ctx.player;
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

  ctx._discardedCount = (ctx._discardedCount ?? 0) + discardCount;

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

function execRedirect(
  game: GameState,
  ctx: EffectExecContext,
  effect: { from: string; to: string },
): GameState {
  if (!ctx.target) return game;
  const fromPlayer = getPlayer(game, ctx.player);
  const discardCard = fromPlayer.hand[0];
  if (!discardCard) return game;

  const newHand = [...fromPlayer.hand];
  newHand.splice(0, 1);

  const targetPlayer = getPlayer(game, effect.to === 'adjacentPlayer' ? findAdjacentPlayer(game, ctx.player) : effect.to);
  if (!targetPlayer) return game;

  return {
    ...updatePlayer(updatePlayer(game, ctx.player, { hand: newHand }), targetPlayer.name, {
      health: targetPlayer.health - 1,
    }),
    discardPile: [...game.discardPile, discardCard],
  };
}

function findAdjacentPlayer(game: GameState, playerName: string): string {
  const alive = game.players.filter(p => p.alive);
  const idx = alive.findIndex(p => p.name === playerName);
  if (idx === -1 || alive.length < 2) return playerName;
  return alive[(idx + 1) % alive.length].name;
}

function execLookAtTopCards(
  game: GameState,
  ctx: EffectExecContext,
  effect: { count: number | string },
): GameState {
  const count = resolveCount(effect.count, ctx);
  const available = Math.min(count, game.deck.length);
  if (available === 0) return game;

  const player = getPlayer(game, ctx.player);
  return updatePlayer(game, ctx.player, {
    hand: [...player.hand, ...game.deck.slice(0, available)],
  });
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
  if (condition === '决斗') return card.name === '决斗';
  if (condition === '反间判定') return true;
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

  if (condition.cardType !== undefined) {
    if (!ctx.card) return false;
    if (condition.cardType === '判定牌' && ctx.card.type !== '锦囊牌') return false;
  }

  if (condition.杀UsedThisTurn !== undefined) {
    if (condition.杀UsedThisTurn && game.killsPlayedThisTurn > 0) return false;
    if (!condition.杀UsedThisTurn && game.killsPlayedThisTurn === 0) return false;
  }

  return true;
}
