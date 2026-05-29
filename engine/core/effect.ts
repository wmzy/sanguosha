import type { GameState, Effect, EffectContext, Condition } from '../../shared/types';

export function executeEffect(
  game: GameState,
  effect: Effect,
  context: EffectContext,
): GameState {
  switch (effect.type) {
    case 'draw':
      return executeDraw(game, context, typeof effect.count === 'number' ? effect.count : 1);
    case 'damage':
      return executeDamage(game, context, effect.amount ?? 1);
    case 'heal':
      return executeHeal(game, context, effect.amount);
    case 'discard':
      return executeDiscard(game, context, typeof effect.count === 'number' ? effect.count : 1);
    case 'gainCard':
      return executeGainCard(game, context, (effect.from as 'deck' | 'discard' | 'player') ?? 'discard');
    case 'skipPhase':
      return game;
    case 'skipDraw':
      return game;
    case 'judge':
      return game;
    case 'addPendingTrick':
      return executeAddPendingTrick(game, context, effect.trickName, effect.target);
    case 'convert':
      return game;
    case 'redirect':
      return game;
    case 'giveCards':
      return game;
    case 'lookAtTopCards':
      return game;
    case 'dealDamage':
      return executeDamage(game, context, effect.amount ?? 1);
    case 'sequence':
      return (effect.steps as Effect[]).reduce(
        (state, step) => executeEffect(state, step, context),
        game,
      );
    case 'conditional':
      return executeConditional(game, effect, context);
    default:
      return game;
  }
}

function executeDraw(game: GameState, ctx: EffectContext, count: number): GameState {
  const drawn = game.deck.slice(0, count);
  const remaining = game.deck.slice(count);
  return {
    ...game,
    deck: remaining,
    players: game.players.map(p =>
      p.name === ctx.player
        ? { ...p, hand: [...p.hand, ...drawn] }
        : p,
    ),
  };
}

function executeDamage(game: GameState, ctx: EffectContext, amount: number): GameState {
  if (!ctx.target) return game;
  return {
    ...game,
    players: game.players.map(p =>
      p.name === ctx.target ? { ...p, health: p.health - amount } : p,
    ),
  };
}

function executeHeal(game: GameState, ctx: EffectContext, amount: number): GameState {
  const healTarget = ctx.target ?? ctx.player;
  return {
    ...game,
    players: game.players.map(p =>
      p.name === healTarget
        ? { ...p, health: Math.min(p.health + amount, p.maxHealth) }
        : p,
    ),
  };
}

function executeDiscard(game: GameState, ctx: EffectContext, count: number): GameState {
  const player = game.players.find(p => p.name === ctx.player);
  if (!player) return game;
  const discarded = player.hand.slice(0, count);
  const remaining = player.hand.slice(count);
  return {
    ...game,
    players: game.players.map(p =>
      p.name === ctx.player ? { ...p, hand: remaining } : p,
    ),
    discardPile: [...game.discardPile, ...discarded],
  };
}

function executeGainCard(game: GameState, ctx: EffectContext, from: 'deck' | 'discard' | 'player'): GameState {
  let card;
  let newGame = game;

  if (from === 'discard' && game.discardPile.length > 0) {
    card = game.discardPile[game.discardPile.length - 1];
    newGame = { ...game, discardPile: game.discardPile.slice(0, -1) };
  } else if (from === 'deck' && game.deck.length > 0) {
    card = game.deck[0];
    newGame = { ...game, deck: game.deck.slice(1) };
  }

  if (!card) return game;

  return {
    ...newGame,
    players: newGame.players.map(p =>
      p.name === ctx.player ? { ...p, hand: [...p.hand, card!] } : p,
    ),
  };
}

function executeAddPendingTrick(
  game: GameState,
  ctx: EffectContext,
  trickName: string,
  target: string,
): GameState {
  const trick = { name: trickName, source: ctx.player, card: ctx.card! };
  return {
    ...game,
    players: game.players.map(p =>
      p.name === target
        ? { ...p, pendingTricks: [...(p.pendingTricks ?? []), trick] }
        : p,
    ),
  };
}

function executeConditional(
  game: GameState,
  effect: { type: 'conditional'; condition: Condition; then: Effect; else?: Effect },
  ctx: EffectContext,
): GameState {
  const conditionMet = checkCondition(game, ctx, effect.condition);
  if (conditionMet) {
    return executeEffect(game, effect.then, ctx);
  } else if (effect.else) {
    return executeEffect(game, effect.else, ctx);
  }
  return game;
}

function checkCondition(game: GameState, ctx: EffectContext, condition: Condition): boolean {
  if (condition.hasHandCards !== undefined) {
    const player = game.players.find(p => p.name === ctx.player);
    if (!player) return false;
    if (condition.hasHandCards && player.hand.length === 0) return false;
    if (!condition.hasHandCards && player.hand.length > 0) return false;
  }
  if (condition.phase) {
    if (game.phase !== condition.phase) return false;
  }
  return true;
}
