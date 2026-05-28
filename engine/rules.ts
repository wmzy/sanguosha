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
  playableCardIndices: number[];
  validTargets: Map<number, string[]>;
  canEndTurn: boolean;
}

// ============================================================
// 距离计算
// ============================================================

/**
 * 计算两个玩家之间的距离
 * 距离 = 两个玩家之间存活玩家数的最小值
 * +1马增加别人到你的距离，-1马减少你到别人的距离
 */
export function getDistance(game: GameState, from: string, to: string): number {
  const alivePlayers = game.players.filter(p => p.alive);
  const n = alivePlayers.length;
  if (n < 2) return 1;

  const fromIdx = alivePlayers.findIndex(p => p.name === from);
  const toIdx = alivePlayers.findIndex(p => p.name === to);
  if (fromIdx === -1 || toIdx === -1) return Infinity;

  // 顺时针和逆时针距离取最小值
  const clockwise = (toIdx - fromIdx + n) % n;
  const counterClockwise = (fromIdx - toIdx + n) % n;
  let distance = Math.min(clockwise, counterClockwise);

  // -1马：减少你到别人的距离
  const fromPlayer = game.players.find(p => p.name === from)!;
  if (fromPlayer.equipment.horseMinus) distance -= 1;

  // +1马：增加别人到你的距离
  const toPlayer = game.players.find(p => p.name === to)!;
  if (toPlayer.equipment.horsePlus) distance += 1;

  return Math.max(distance, 1);
}

/**
 * 获取攻击范围（默认1，武器可增加）
 */
export function getAttackRange(player: Player): number {
  if (player.equipment.weapon?.range) {
    return player.equipment.weapon.range;
  }
  return 1;
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
      // 每回合只能出一张杀（除非有诸葛连弩）
      // TODO: 需要跟踪本回合是否已出过杀
      return getValidTargetsForCard(game, player, card).length > 0;
    case '桃':
      // 可以给自己用（非满血），也可以给濒死队友用（暂不实现）
      return player.health < player.maxHealth;
    case '闪':
    case '无懈可击':
      return false; // 响应牌
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
  const attackRange = getAttackRange(player);

  switch (card.name) {
    case '杀':
      // 杀的范围 = 攻击范围
      return others
        .filter(p => getDistance(game, player.name, p.name) <= attackRange)
        .map(p => p.name);
    case '过河拆桥':
      return others
        .filter(p => p.hand.length > 0 || hasEquipment(p))
        .map(p => p.name);
    case '顺手牵羊':
      // 距离1以内
      return others
        .filter(p => getDistance(game, player.name, p.name) <= 1)
        .filter(p => p.hand.length > 0 || hasEquipment(p))
        .map(p => p.name);
    case '决斗':
      return others.map(p => p.name);
    default:
      return [];
  }
}

function hasEquipment(player: Player): boolean {
  return Object.values(player.equipment).some(Boolean);
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
