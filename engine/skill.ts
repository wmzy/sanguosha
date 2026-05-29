import type { GameState, Player, AbilityConfig, Card, Condition } from '../shared/types';

// ============================================================
// 技能上下文（传递触发事件的详细信息）
// ============================================================

export interface SkillContext {
  player?: string; // 触发技能的玩家
  attacker?: string; // 攻击者
  target?: string; // 目标
  card?: Card; // 相关卡牌
  damageSourceCard?: Card; // 造成伤害的牌
  amount?: number; // 伤害/回复数值
}

// ============================================================
// 技能可用性检查
// ============================================================

export interface SkillAvailability {
  ability: AbilityConfig;
  playerName: string;
  canActivate: boolean;
  reason?: string;
}

export function getAvailableSkills(game: GameState, playerName: string): SkillAvailability[] {
  const player = game.players.find(p => p.name === playerName);
  if (!player?.alive) return [];

  return player.character.abilities.map(ability =>
    checkSkillAvailability(game, player, ability),
  );
}

function checkSkillAvailability(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillAvailability {
  if (ability.passive) {
    return { ability, playerName: player.name, canActivate: false, reason: '被动技能' };
  }

  if (ability.condition?.phase && game.phase !== ability.condition.phase) {
    return { ability, playerName: player.name, canActivate: false, reason: '当前阶段不能发动' };
  }

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

export function executeSkill(
  game: GameState,
  playerName: string,
  ability: AbilityConfig,
  context?: SkillContext,
): SkillResult {
  const player = game.players.find(p => p.name === playerName);
  if (!player) return { success: false, game, message: '玩家不存在' };

  switch (ability.effect.type) {
    case 'gainCard':
      return executeGainCard(game, player, ability, context);
    case 'draw':
      return executeDraw(game, player, ability);
    case 'heal':
      return executeHeal(game, player, ability);
    case 'discard':
      return executeDiscard(game, player, ability);
    case 'skipPhase':
      return executeSkipPhase(game, player, ability);
    case 'lookAtTopCards':
      return executeLookAtTopCards(game, player, ability);
    case 'giveCards':
      return executeGiveCards(game, player, ability, context);
    default:
      return { success: false, game, message: `未实现的效果类型: ${ability.effect.type}` };
  }
}

// ============================================================
// 效果实现
// ============================================================

function executeGainCard(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
  context?: SkillContext,
): SkillResult {
  const effect = ability.effect;
  if (effect.type !== 'gainCard') return { success: false, game, message: '效果类型不匹配' };

  const source = effect.source;
  let card: Card | undefined;
  let newGame = game;

  switch (source) {
    case 'damageSourceCard': {
      // 获得造成伤害的牌
      card = context?.damageSourceCard;
      if (!card) {
        return { success: false, game, message: '没有造成伤害的牌' };
      }
      // 从弃牌堆移除该牌（如果在那里）
      const discardIdx = newGame.discardPile.findIndex(c => c.name === card!.name && c.suit === card!.suit && c.rank === card!.rank);
      if (discardIdx >= 0) {
        newGame = {
          ...newGame,
          discardPile: newGame.discardPile.filter((_, i) => i !== discardIdx),
        };
      }
      break;
    }

    case 'attacker': {
      // 获得攻击者的一张牌
      const attackerName = context?.attacker;
      if (!attackerName) {
        return { success: false, game, message: '没有攻击者' };
      }
      const attacker = newGame.players.find(p => p.name === attackerName);
      if (!attacker || attacker.hand.length === 0) {
        return { success: false, game, message: '攻击者没有手牌' };
      }
      // 随机获得一张牌
      const randomIdx = Math.floor(Math.random() * attacker.hand.length);
      card = attacker.hand[randomIdx];
      newGame = {
        ...newGame,
        players: newGame.players.map(p => {
          if (p.name === attackerName) {
            const newHand = [...p.hand];
            newHand.splice(randomIdx, 1);
            return { ...p, hand: newHand };
          }
          return p;
        }),
      };
      break;
    }

    case 'judgeCard':
      // 获得判定牌（暂不实现）
      return { success: false, game, message: '判定牌获取暂未实现' };

    default:
      // 从弃牌堆获得
      if (newGame.discardPile.length === 0) {
        return { success: false, game, message: '弃牌堆为空' };
      }
      card = newGame.discardPile[newGame.discardPile.length - 1];
      newGame = {
        ...newGame,
        discardPile: newGame.discardPile.slice(0, -1),
      };
      break;
  }

  if (!card) {
    return { success: false, game, message: '无法获得卡牌' };
  }

  // 将牌加入玩家手牌
  newGame = {
    ...newGame,
    players: newGame.players.map(p =>
      p.name === player.name
        ? { ...p, hand: [...p.hand, card] }
        : p,
    ),
  };

  return {
    success: true,
    game: newGame,
    message: `${player.name} 发动 ${ability.name}，获得了 ${card.name}`,
  };
}

function executeDraw(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillResult {
  const effect = ability.effect;
  if (effect.type !== 'draw') return { success: false, game, message: '效果类型不匹配' };

  const count = typeof effect.count === 'number' ? effect.count : 1;
  const drawn = game.deck.slice(0, count);
  const newDeck = game.deck.slice(count);

  if (drawn.length === 0) {
    return { success: false, game, message: '牌堆为空' };
  }

  return {
    success: true,
    game: {
      ...game,
      players: game.players.map(p =>
        p.name === player.name
          ? { ...p, hand: [...p.hand, ...drawn] }
          : p,
      ),
      deck: newDeck,
    },
    message: `${player.name} 发动 ${ability.name}，摸了 ${drawn.length} 张牌`,
  };
}

function executeHeal(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillResult {
  const effect = ability.effect;
  if (effect.type !== 'heal') return { success: false, game, message: '效果类型不匹配' };

  const amount = effect.amount ?? 1;
  if (player.health >= player.maxHealth) {
    return { success: false, game, message: '体力已满' };
  }

  return {
    success: true,
    game: {
      ...game,
      players: game.players.map(p =>
        p.name === player.name
          ? { ...p, health: Math.min(p.health + amount, p.maxHealth) }
          : p,
      ),
    },
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

  // 弃置最后一张牌
  const discarded = player.hand[player.hand.length - 1];
  const newHand = player.hand.slice(0, -1);

  return {
    success: true,
    game: {
      ...game,
      players: game.players.map(p =>
        p.name === player.name
          ? { ...p, hand: newHand }
          : p,
      ),
      discardPile: [...game.discardPile, discarded],
    },
    message: `${player.name} 发动 ${ability.name}，弃置了 ${discarded.name}`,
  };
}

function executeSkipPhase(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillResult {
  const effect = ability.effect;
  if (effect.type !== 'skipPhase') return { success: false, game, message: '效果类型不匹配' };

  return {
    success: true,
    game,
    message: `${player.name} 发动 ${ability.name}，跳过${effect.target ?? '当前'}阶段`,
  };
}

// ============================================================
// 观星：查看牌堆顶N张牌，重新排序
// ============================================================

function executeLookAtTopCards(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
): SkillResult {
  const effect = ability.effect;
  if (effect.type !== 'lookAtTopCards') return { success: false, game, message: '效果类型不匹配' };

  // 计算查看数量：存活角色数，最多5张
  const aliveCount = game.players.filter(p => p.alive).length;
  const count = Math.min(aliveCount, 5);
  const topCards = game.deck.slice(0, count);

  if (topCards.length === 0) {
    return { success: false, game, message: '牌堆为空' };
  }

  // 简化实现：自动将所有牌放回牌堆顶（不做排序）
  // 完整实现需要 UI 交互让玩家选择排序
  return {
    success: true,
    game, // 牌堆不变（简化）
    message: `${player.name} 发动 ${ability.name}，查看了牌堆顶 ${topCards.length} 张牌：${topCards.map(c => c.name).join('、')}`,
  };
}

// ============================================================
// 仁德：将手牌交给其他角色
// ============================================================

function executeGiveCards(
  game: GameState,
  player: Player,
  ability: AbilityConfig,
  context?: SkillContext,
): SkillResult {
  const effect = ability.effect;
  if (effect.type !== 'giveCards') return { success: false, game, message: '效果类型不匹配' };

  const targetName = context?.target;
  if (!targetName) {
    return { success: false, game, message: '需要选择目标' };
  }

  const target = game.players.find(p => p.name === targetName);
  if (!target?.alive) {
    return { success: false, game, message: '目标不存在或已死亡' };
  }

  if (player.hand.length === 0) {
    return { success: false, game, message: '没有手牌' };
  }

  // 给出最后一张牌（简化实现）
  const card = player.hand[player.hand.length - 1];
  const newHand = player.hand.slice(0, -1);

  const newPlayers = game.players.map(p => {
    if (p.name === player.name) {
      return { ...p, hand: newHand };
    }
    if (p.name === targetName) {
      return { ...p, hand: [...p.hand, card] };
    }
    return p;
  });

  // 检查是否给出了2张或更多（仁德回血条件）
  // 简化：不跟踪本阶段给出的牌数

  return {
    success: true,
    game: { ...game, players: newPlayers },
    message: `${player.name} 发动 ${ability.name}，将 ${card.name} 交给了 ${targetName}`,
  };
}

// ============================================================
// 被动技能触发
// ============================================================

export function triggerPassiveSkills(
  game: GameState,
  trigger: string,
  context: SkillContext,
): GameState {
  let currentGame = game;

  for (const player of currentGame.players) {
    if (!player.alive) continue;

    for (const ability of player.character.abilities) {
      if (!ability.passive || ability.trigger !== trigger) continue;

      if (ability.condition && !checkCondition(currentGame, player, ability.condition, context)) {
        continue;
      }

      const result = executeSkill(currentGame, player.name, ability, context);
      if (result.success) {
        currentGame = result.game;
      }
    }
  }

  return currentGame;
}

function checkCondition(
  game: GameState,
  player: Player,
  condition: Condition,
  context: SkillContext,
): boolean {
  // 检查阶段条件
  if (condition.phase && game.phase !== condition.phase) {
    return false;
  }

  // 检查是否有手牌
  if (condition.hasHandCards && player.hand.length === 0) {
    return false;
  }

  // 检查攻击者条件（如孙权救援：吴势力角色对你使用桃）
  if (condition.faction && context.attacker) {
    const attacker = game.players.find(p => p.name === context.attacker);
    if (attacker?.character.faction !== condition.faction) {
      return false;
    }
  }

  return true;
}
