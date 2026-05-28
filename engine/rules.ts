import type { GameState, Player, Card, PlayerAction } from '../shared/types';

// ============================================================
// 验证结果
// ============================================================

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ============================================================
// 可用操作
// ============================================================

export interface ValidActions {
  playableCardIndices: number[]; // 可出的牌的索引
  validTargets: Map<number, string[]>; // 牌索引 → 可选目标玩家名
  canEndTurn: boolean;
}

// ============================================================
// 细粒度查询函数
// ============================================================

/**
 * 判断一张牌是否可以主动使用
 */
export function isCardPlayable(game: GameState, player: Player, card: Card): boolean {
  if (game.phase !== '出牌') return false;
  if (game.currentPlayer !== player.name) return false;

  switch (card.name) {
    case '杀':
      return getValidTargetsForCard(game, player, card).length > 0;
    case '桃':
      return player.health < player.maxHealth;
    case '闪':
    case '无懈可击':
      return false; // 响应牌，不能主动出
    case '过河拆桥':
    case '顺手牵羊':
      return getValidTargetsForCard(game, player, card).length > 0;
    case '决斗':
      return getValidTargetsForCard(game, player, card).length > 0;
    case '无中生有':
    case '万箭齐发':
    case '南蛮入侵':
    case '桃园结义':
    case '五谷丰登':
      return true;
    default:
      break;
  }

  // 装备牌
  if (card.subtype === '武器' || card.subtype === '防具' || card.subtype === '进攻马' || card.subtype === '防御马') {
    return true;
  }

  return false;
}

/**
 * 获取一张牌的合法目标
 */
export function getValidTargetsForCard(game: GameState, player: Player, card: Card): string[] {
  const others = game.players.filter(p => p.name !== player.name && p.alive);

  switch (card.name) {
    case '杀':
      // 杀的范围检查（简化：不考虑武器距离）
      return others.map(p => p.name);
    case '过河拆桥':
      return others.filter(p => p.hand.length > 0 || Object.values(p.equipment).some(Boolean)).map(p => p.name);
    case '顺手牵羊':
      // 距离1以内（简化：所有人）
      return others.filter(p => p.hand.length > 0 || Object.values(p.equipment).some(Boolean)).map(p => p.name);
    case '决斗':
      return others.map(p => p.name);
    default:
      return [];
  }
}

/**
 * 判断是否可以结束回合
 */
export function canEndTurn(game: GameState, playerName: string): boolean {
  return game.currentPlayer === playerName && game.phase === '出牌';
}

/**
 * 验证一个操作是否合法
 */
export function validateAction(game: GameState, playerName: string, action: PlayerAction): ValidationResult {
  if (game.currentPlayer !== playerName) {
    return { valid: false, reason: '不是你的回合' };
  }

  if (game.phase !== '出牌' && action.type !== '弃牌') {
    return { valid: false, reason: '当前阶段不能执行此操作' };
  }

  switch (action.type) {
    case '出牌': {
      const player = game.players.find(p => p.name === playerName);
      if (!player) return { valid: false, reason: '玩家不存在' };

      const card = action.card;
      if (!player.hand.some(c => c.name === card.name && c.suit === card.suit && c.rank === card.rank)) {
        return { valid: false, reason: '你没有这张牌' };
      }

      if (!isCardPlayable(game, player, card)) {
        return { valid: false, reason: '这张牌不能使用' };
      }

      // 需要目标的牌
      const needsTarget = ['杀', '过河拆桥', '顺手牵羊', '决斗'].includes(card.name);
      if (needsTarget) {
        if (!action.target) {
          return { valid: false, reason: '需要选择目标' };
        }
        const validTargets = getValidTargetsForCard(game, player, card);
        if (!validTargets.includes(action.target)) {
          return { valid: false, reason: '目标不合法' };
        }
      }

      return { valid: true };
    }

    case '结束回合':
      if (!canEndTurn(game, playerName)) {
        return { valid: false, reason: '当前不能结束回合' };
      }
      return { valid: true };

    default:
      return { valid: false, reason: '未知操作类型' };
  }
}

// ============================================================
// 组合查询
// ============================================================

/**
 * 获取当前玩家的所有可用操作
 */
export function getValidActions(game: GameState, playerName: string): ValidActions {
  const player = game.players.find(p => p.name === playerName);
  if (!player || game.currentPlayer !== playerName) {
    return { playableCardIndices: [], validTargets: new Map(), canEndTurn: false };
  }

  const playableCardIndices: number[] = [];
  const validTargets = new Map<number, string[]>();

  player.hand.forEach((card, index) => {
    if (isCardPlayable(game, player, card)) {
      playableCardIndices.push(index);
      const targets = getValidTargetsForCard(game, player, card);
      if (targets.length > 0) {
        validTargets.set(index, targets);
      }
    }
  });

  return {
    playableCardIndices,
    validTargets,
    canEndTurn: canEndTurn(game, playerName),
  };
}
