// engine/effect.ts
import type { GameState } from '../shared/types';
import type { GameLogger } from './logger';

interface EffectResult {
  success: boolean;
  status: GameState;
  message: string;
}

export function playKill(game: GameState, userName: string, targetName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);
  const target = game.players.find(p => p.name === targetName);

  if (!user || !target) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  if (userName === targetName) {
    return { success: false, status: game, message: '不能对自己使用杀' };
  }

  if (!target.alive) {
    return { success: false, status: game, message: '目标已死亡' };
  }

  // 造成1点伤害
  const newPlayers = game.players.map(p => {
    if (p.name === targetName) {
      return { ...p, health: p.health - 1 };
    }
    return p;
  });

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers },
    message: `${userName} 对 ${targetName} 使用杀，造成1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: userName,
      target: targetName,
      amount: 1,
      cardName: '杀',
    }, `${userName} 对 ${targetName} 使用杀，造成1点伤害`);
    for (const player of game.players) {
      logger.logPlayerOp(player.name, 'damage', {
        source: userName,
        target: targetName,
        amount: 1,
      }, `${userName} 对 ${targetName} 使用杀，造成1点伤害`);
    }
  }

  return result;
}

export function playPeach(game: GameState, userName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);

  if (!user) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  if (user.health >= user.maxHealth) {
    return { success: false, status: game, message: '体力已满，不能使用桃' };
  }

  const newPlayers = game.players.map(p => {
    if (p.name === userName) {
      return { ...p, health: Math.min(p.health + 1, p.maxHealth) };
    }
    return p;
  });

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers },
    message: `${userName} 使用桃，恢复1点体力`,
  };

  if (logger) {
    logger.logServerOp('heal', {
      player: userName,
      amount: 1,
      newHealth: user.health + 1,
    }, `${userName} 使用桃，恢复1点体力`);
    for (const player of game.players) {
      logger.logPlayerOp(player.name, 'heal', {
        player: userName,
        amount: 1,
      }, `${userName} 使用桃，恢复1点体力`);
    }
  }

  return result;
}

// ============================================================
// 普通锦囊 - 单目标
// ============================================================

export function playDismantle(game: GameState, userName: string, targetName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);
  const target = game.players.find(p => p.name === targetName);

  if (!user || !target) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  if (userName === targetName) {
    return { success: false, status: game, message: '不能对自己使用过河拆桥' };
  }

  if (!target.alive) {
    return { success: false, status: game, message: '目标已死亡' };
  }

  if (target.hand.length === 0) {
    return { success: false, status: game, message: `${targetName} 没有手牌` };
  }

  // 随机弃置目标一张手牌
  const discardIndex = Math.floor(Math.random() * target.hand.length);
  const discardedCard = target.hand[discardIndex];

  const newPlayers = game.players.map(p => {
    if (p.name === targetName) {
      return { ...p, hand: p.hand.filter((_, i) => i !== discardIndex) };
    }
    return p;
  });

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers, discardPile: [...game.discardPile, discardedCard] },
    message: `${userName} 对 ${targetName} 使用过河拆桥，弃置了一张牌`,
  };

  if (logger) {
    logger.logServerOp('discard', {
      source: userName,
      target: targetName,
      cards: [{ name: discardedCard.name, suit: discardedCard.suit, rank: discardedCard.rank }],
    }, `${userName} 对 ${targetName} 使用过河拆桥，弃置了 ${discardedCard.name}`);
    for (const player of game.players) {
      // 使用者看到被弃的牌，目标和其他人只知道被弃了一张牌
      const description = player.name === userName || player.name === targetName
        ? `${userName} 对 ${targetName} 使用过河拆桥，弃置了 ${discardedCard.name}`
        : `${userName} 对 ${targetName} 使用过河拆桥，弃置了一张牌`;
      logger.logPlayerOp(player.name, 'discard', {
        source: userName,
        target: targetName,
        cards: [{ name: discardedCard.name, suit: discardedCard.suit, rank: discardedCard.rank }],
      }, description);
    }
  }

  return result;
}

export function playSteal(game: GameState, userName: string, targetName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);
  const target = game.players.find(p => p.name === targetName);

  if (!user || !target) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  if (userName === targetName) {
    return { success: false, status: game, message: '不能对自己使用顺手牵羊' };
  }

  if (!target.alive) {
    return { success: false, status: game, message: '目标已死亡' };
  }

  if (target.hand.length === 0 && !target.equipment.weapon && !target.equipment.armor && !target.equipment.horsePlus && !target.equipment.horseMinus) {
    return { success: false, status: game, message: `${targetName} 没有任何牌` };
  }

  // 优先从手牌中随机获得，简化实现不考虑距离
  if (target.hand.length > 0) {
    const gainIndex = Math.floor(Math.random() * target.hand.length);
    const gainedCard = target.hand[gainIndex];

    const newPlayers = game.players.map(p => {
      if (p.name === targetName) {
        return { ...p, hand: p.hand.filter((_, i) => i !== gainIndex) };
      }
      if (p.name === userName) {
        return { ...p, hand: [...p.hand, gainedCard] };
      }
      return p;
    });

    const result: EffectResult = {
      success: true,
      status: { ...game, players: newPlayers },
      message: `${userName} 对 ${targetName} 使用顺手牵羊，获得了一张牌`,
    };

    if (logger) {
      logger.logServerOp('play', {
        source: userName,
        target: targetName,
        cards: [{ name: gainedCard.name, suit: gainedCard.suit, rank: gainedCard.rank }],
      }, `${userName} 对 ${targetName} 使用顺手牵羊，获得了 ${gainedCard.name}`);
      for (const player of game.players) {
        const description = player.name === userName
          ? `${userName} 对 ${targetName} 使用顺手牵羊，获得了 ${gainedCard.name}`
          : `${userName} 对 ${targetName} 使用顺手牵羊，获得了一张牌`;
        logger.logPlayerOp(player.name, 'play', {
          source: userName,
          target: targetName,
          cards: [{ name: gainedCard.name, suit: gainedCard.suit, rank: gainedCard.rank }],
        }, description);
      }
    }

    return result;
  }

  return { success: false, status: game, message: `${targetName} 没有手牌` };
}

export function playDrawTwo(game: GameState, userName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);

  if (!user) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  if (game.deck.length < 2) {
    return { success: false, status: game, message: '牌堆不足' };
  }

  const drawnCards = game.deck.slice(0, 2);
  const newDeck = game.deck.slice(2);

  const newPlayers = game.players.map(p => {
    if (p.name === userName) {
      return { ...p, hand: [...p.hand, ...drawnCards] };
    }
    return p;
  });

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers, deck: newDeck },
    message: `${userName} 使用无中生有，摸了2张牌`,
  };

  if (logger) {
    logger.logServerOp('draw', {
      player: userName,
      cards: drawnCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
    }, `${userName} 使用无中生有，摸了2张牌`);
    for (const player of game.players) {
      logger.logPlayerOp(player.name, 'draw', {
        player: userName,
        cards: drawnCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
      }, `${userName} 使用无中生有，摸了2张牌`);
    }
  }

  return result;
}

export function playDuel(game: GameState, userName: string, targetName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);
  const target = game.players.find(p => p.name === targetName);

  if (!user || !target) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  if (userName === targetName) {
    return { success: false, status: game, message: '不能对自己使用决斗' };
  }

  if (!target.alive) {
    return { success: false, status: game, message: '目标已死亡' };
  }

  // 简化实现：直接对目标造成1点伤害（完整实现需要轮流出杀）
  const newPlayers = game.players.map(p => {
    if (p.name === targetName) {
      return { ...p, health: p.health - 1 };
    }
    return p;
  });

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers },
    message: `${userName} 对 ${targetName} 使用决斗，造成1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: userName,
      target: targetName,
      amount: 1,
      cardName: '决斗',
    }, `${userName} 对 ${targetName} 使用决斗，造成1点伤害`);
    for (const player of game.players) {
      logger.logPlayerOp(player.name, 'damage', {
        source: userName,
        target: targetName,
        amount: 1,
      }, `${userName} 对 ${targetName} 使用决斗，造成1点伤害`);
    }
  }

  return result;
}

// ============================================================
// 普通锦囊 - 全体
// ============================================================

export function playArrowBarrage(game: GameState, userName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);

  if (!user) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  const otherAlivePlayers = game.players.filter(p => p.alive && p.name !== userName);

  if (otherAlivePlayers.length === 0) {
    return { success: false, status: game, message: '没有其他存活的玩家' };
  }

  // 简化实现：所有其他存活玩家各受1点伤害（完整实现需要每名角色响应闪）
  const newPlayers = game.players.map(p => {
    if (p.alive && p.name !== userName) {
      return { ...p, health: p.health - 1 };
    }
    return p;
  });

  const injuredNames = otherAlivePlayers.map(p => p.name).join('、');

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers },
    message: `${userName} 使用万箭齐发，${injuredNames} 各受到1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: userName,
      targets: otherAlivePlayers.map(p => p.name),
      amount: 1,
      cardName: '万箭齐发',
    }, `${userName} 使用万箭齐发，${injuredNames} 各受到1点伤害`);
    for (const player of game.players) {
      logger.logPlayerOp(player.name, 'damage', {
        source: userName,
        targets: otherAlivePlayers.map(p => p.name),
        amount: 1,
      }, `${userName} 使用万箭齐发，${injuredNames} 各受到1点伤害`);
    }
  }

  return result;
}

export function playBarbarianInvasion(game: GameState, userName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);

  if (!user) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  const otherAlivePlayers = game.players.filter(p => p.alive && p.name !== userName);

  if (otherAlivePlayers.length === 0) {
    return { success: false, status: game, message: '没有其他存活的玩家' };
  }

  // 简化实现：所有其他存活玩家各受1点伤害（完整实现需要每名角色响应杀）
  const newPlayers = game.players.map(p => {
    if (p.alive && p.name !== userName) {
      return { ...p, health: p.health - 1 };
    }
    return p;
  });

  const injuredNames = otherAlivePlayers.map(p => p.name).join('、');

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers },
    message: `${userName} 使用南蛮入侵，${injuredNames} 各受到1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: userName,
      targets: otherAlivePlayers.map(p => p.name),
      amount: 1,
      cardName: '南蛮入侵',
    }, `${userName} 使用南蛮入侵，${injuredNames} 各受到1点伤害`);
    for (const player of game.players) {
      logger.logPlayerOp(player.name, 'damage', {
        source: userName,
        targets: otherAlivePlayers.map(p => p.name),
        amount: 1,
      }, `${userName} 使用南蛮入侵，${injuredNames} 各受到1点伤害`);
    }
  }

  return result;
}

export function playPeachGarden(game: GameState, userName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);

  if (!user) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  const alivePlayers = game.players.filter(p => p.alive);
  const needHealing = alivePlayers.filter(p => p.health < p.maxHealth);

  if (needHealing.length === 0) {
    return { success: false, status: game, message: '所有存活玩家体力已满' };
  }

  const newPlayers = game.players.map(p => {
    if (p.alive && p.health < p.maxHealth) {
      return { ...p, health: Math.min(p.health + 1, p.maxHealth) };
    }
    return p;
  });

  const healedNames = needHealing.map(p => p.name).join('、');

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers },
    message: `${userName} 使用桃园结义，${healedNames} 各恢复1点体力`,
  };

  if (logger) {
    logger.logServerOp('heal', {
      source: userName,
      targets: needHealing.map(p => p.name),
      amount: 1,
    }, `${userName} 使用桃园结义，${healedNames} 各恢复1点体力`);
    for (const player of game.players) {
      logger.logPlayerOp(player.name, 'heal', {
        source: userName,
        targets: needHealing.map(p => p.name),
        amount: 1,
      }, `${userName} 使用桃园结义，${healedNames} 各恢复1点体力`);
    }
  }

  return result;
}

export function playAbundance(game: GameState, userName: string, logger?: GameLogger): EffectResult {
  const user = game.players.find(p => p.name === userName);

  if (!user) {
    return { success: false, status: game, message: '玩家不存在' };
  }

  const alivePlayers = game.players.filter(p => p.alive);

  if (game.deck.length < alivePlayers.length) {
    return { success: false, status: game, message: '牌堆不足' };
  }

  // 简化实现：每人直接从牌堆摸1张（完整实现需要展示后依次选择）
  const revealedCards = game.deck.slice(0, alivePlayers.length);
  const newDeck = game.deck.slice(alivePlayers.length);

  const newPlayers = game.players.map(p => {
    if (p.alive) {
      const index = alivePlayers.findIndex(sp => sp.name === p.name);
      return { ...p, hand: [...p.hand, revealedCards[index]] };
    }
    return p;
  });

  const distributionInfo = alivePlayers.map((p, i) => `${p.name} 获得 ${revealedCards[i].name}`).join('、');

  const result: EffectResult = {
    success: true,
    status: { ...game, players: newPlayers, deck: newDeck },
    message: `${userName} 使用五谷丰登，${distributionInfo}`,
  };

  if (logger) {
    logger.logServerOp('draw', {
      source: userName,
      revealed: revealedCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
      distribution: Object.fromEntries(alivePlayers.map((p, i) => [p.name, { name: revealedCards[i].name, suit: revealedCards[i].suit, rank: revealedCards[i].rank }])),
    }, `${userName} 使用五谷丰登，亮出了 ${revealedCards.map(c => c.name).join('、')}`);
    for (const player of game.players) {
      if (player.alive) {
        const index = alivePlayers.findIndex(sp => sp.name === player.name);
        logger.logPlayerOp(player.name, 'draw', {
          player: player.name,
          cards: [{ name: revealedCards[index].name, suit: revealedCards[index].suit, rank: revealedCards[index].rank }],
        }, `五谷丰登: ${player.name} 获得 ${revealedCards[index].name}`);
      }
    }
  }

  return result;
}

export function resolveEffect(game: GameState, _effect: Record<string, unknown>): EffectResult {
  // 通用效果解析器，后续扩展
  return { success: false, status: game, message: '未实现的效果类型' };
}
