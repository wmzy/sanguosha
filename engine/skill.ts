import type { GameState, Player, AbilityConfig, Card } from '../shared/types';

// ============================================================
// 技能可用性检查
// ============================================================

export interface SkillAvailability {
  ability: AbilityConfig;
  playerName: string;
  canActivate: boolean;
  reason?: string;
}

/**
 * 检查玩家的哪些技能可以发动
 */
export function getAvailableSkills(game: GameState, playerName: string): SkillAvailability[] {
  const player = game.players.find(p => p.name === playerName);
  if (!player || !player.alive) return [];

  const results: SkillAvailability[] = [];

  for (const ability of player.character.abilities) {
    const result = checkSkillAvailability(game, player, ability);
    results.push(result);
  }

  return results;
}

function checkSkillAvailability(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillAvailability {
  // 被动技能不能手动发动
  if (ability.passive) {
    return { ability, playerName: player.name, canActivate: false, reason: '被动技能' };
  }

  // 检查是否在正确的阶段
  if (ability.condition?.phase && game.phase !== ability.condition.phase) {
    return { ability, playerName: player.name, canActivate: false, reason: '当前阶段不能发动' };
  }

  // 检查是否有手牌（如果需要）
  if (ability.condition?.hasHandCards && player.hand.length === 0) {
    return { ability, playerName: player.name, canActivate: false, reason: '没有手牌' };
  }

  return { ability, playerName: player.name, canActivate: true };
}

// ============================================================
// 技能效果执行
// ============================================================

export interface SkillResult {
  success: boolean;
  game: GameState;
  message: string;
}

/**
 * 执行技能效果
 */
export function executeSkill(
  game: GameState,
  playerName: string,
  ability: AbilityConfig,
  target?: string,
): SkillResult {
  const player = game.players.find(p => p.name === playerName);
  if (!player) return { success: false, game, message: '玩家不存在' };

  switch (ability.effect.type) {
    case 'gainCard':
      return executeGainCard(game, player, ability, target);
    case 'draw':
      return executeDraw(game, player, ability);
    case 'heal':
      return executeHeal(game, player, ability);
    case 'discard':
      return executeDiscard(game, player, ability);
    default:
      return { success: false, game, message: `未实现的效果类型: ${ability.effect.type}` };
  }
}

function executeGainCard(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
  _target?: string,
): SkillResult {
  // 简化实现：从弃牌堆获得一张牌
  if (game.discardPile.length === 0) {
    return { success: false, game, message: '弃牌堆为空' };
  }

  const card = game.discardPile[game.discardPile.length - 1];
  const newDiscard = game.discardPile.slice(0, -1);
  const newPlayers = game.players.map(p =>
    p.name === player.name
      ? { ...p, hand: [...p.hand, card] }
      : p,
  );

  return {
    success: true,
    game: { ...game, players: newPlayers, discardPile: newDiscard },
    message: `${player.name} 发动 ${ability.name}，获得了 ${card.name}`,
  };
}

function executeDraw(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillResult {
  const effect = ability.effect;
  const count = effect.type === 'draw' ? (effect.count as number) : 1;
  const drawn = game.deck.slice(0, count);
  const newDeck = game.deck.slice(count);

  if (drawn.length === 0) {
    return { success: false, game, message: '牌堆为空' };
  }

  const newPlayers = game.players.map(p =>
    p.name === player.name
      ? { ...p, hand: [...p.hand, ...drawn] }
      : p,
  );

  return {
    success: true,
    game: { ...game, players: newPlayers, deck: newDeck },
    message: `${player.name} 发动 ${ability.name}，摸了 ${drawn.length} 张牌`,
  };
}

function executeHeal(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillResult {
  const effect = ability.effect;
  const amount = effect.type === 'heal' ? (effect.amount ?? 1) : 1;
  if (player.health >= player.maxHealth) {
    return { success: false, game, message: '体力已满' };
  }

  const newPlayers = game.players.map(p =>
    p.name === player.name
      ? { ...p, health: Math.min(p.health + amount, p.maxHealth) }
      : p,
  );

  return {
    success: true,
    game: { ...game, players: newPlayers },
    message: `${player.name} 发动 ${ability.name}，恢复了 ${amount} 点体力`,
  };
}

function executeDiscard(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillResult {
  if (player.hand.length === 0) {
    return { success: false, game, message: '没有手牌' };
  }

  // 弃一张牌
  const discarded = player.hand[0];
  const newHand = player.hand.slice(1);
  const newPlayers = game.players.map(p =>
    p.name === player.name
      ? { ...p, hand: newHand }
      : p,
  );

  return {
    success: true,
    game: { ...game, players: newPlayers, discardPile: [...game.discardPile, discarded] },
    message: `${player.name} 发动 ${ability.name}，弃置了 ${discarded.name}`,
  };
}

// ============================================================
// 被动技能触发
// ============================================================

/**
 * 检查并触发被动技能
 */
export function triggerPassiveSkills(
  game: GameState,
  trigger: string,
  context: { player?: string; attacker?: string; card?: Card },
): GameState {
  let currentGame = game;

  for (const player of currentGame.players) {
    if (!player.alive) continue;

    for (const ability of player.character.abilities) {
      if (!ability.passive || ability.trigger !== trigger) continue;

      // 检查条件
      if (ability.condition && !checkCondition(currentGame, player, ability.condition, context)) {
        continue;
      }

      // 执行被动技能
      const result = executeSkill(currentGame, player.name, ability);
      if (result.success) {
        currentGame = result.game;
      }
    }
  }

  return currentGame;
}

function checkCondition(
  _game: GameState,
  _player: Player,
  _condition: Record<string, unknown>,
  _context: Record<string, unknown>,
): boolean {
  // 简化实现：总是满足条件
  return true;
}
