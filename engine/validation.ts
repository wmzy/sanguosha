import type { GameState, PlayerAction, Card, CardDef } from '../shared/types';
import type { ValidationResult, ValidActions } from './types';
import { getAlivePlayers, getPlayer } from './state';
import { isInAttackRange } from './distance';
import { getAvailableSkills } from './skill';
import { getConversionTargets } from './convert';
import { 基本牌列表, 锦囊牌列表, 装备牌列表 } from '../shared/cards/index';

const allCardDefs: CardDef[] = [...基本牌列表, ...锦囊牌列表, ...装备牌列表];
const cardDefMap = new Map(allCardDefs.map(d => [d.name, d]));

export function getCardDef(name: string): CardDef | undefined {
  return cardDefMap.get(name);
}

export class ValidationPipeline {
  validateAction(game: GameState, playerName: string, action: PlayerAction): ValidationResult {
    if (game.status !== '进行中') {
      return { valid: false, reason: '游戏未在进行中' };
    }

    if (action.type === '出牌') {
      return validatePlayCard(game, playerName, action.card, action.target);
    }

    if (action.type === '结束回合') {
      return validateEndTurn(game, playerName);
    }

    if (action.type === '弃牌') {
      return { valid: true };
    }

    if (action.type === '响应') {
      return { valid: true };
    }

    if (action.type === '发动技能') {
      return { valid: true };
    }

    return { valid: false, reason: '未知操作' };
  }
}

function validatePlayCard(
  game: GameState,
  playerName: string,
  card: Card,
  target?: string,
): ValidationResult {
  if (game.phase !== '出牌') {
    return { valid: false, reason: '当前阶段不能出牌' };
  }

  if (game.currentPlayer !== playerName) {
    return { valid: false, reason: '不是你的回合' };
  }

  const player = getPlayer(game, playerName);

  if (!player.hand.some(c => c.id === card.id)) {
    return { valid: false, reason: '你没有这张牌' };
  }

  if (!isCardPlayable(game, player, card)) {
    return { valid: false, reason: '这张牌不能使用' };
  }

  if (target) {
    const targets = getValidTargetsForCard(game, player, card);
    if (!targets.includes(target)) {
      return { valid: false, reason: '无效目标' };
    }
  }

  return { valid: true };
}

function validateEndTurn(game: GameState, playerName: string): ValidationResult {
  if (game.phase !== '出牌') {
    return { valid: false, reason: '当前阶段不能结束回合' };
  }

  if (game.currentPlayer !== playerName) {
    return { valid: false, reason: '不是你的回合' };
  }

  return { valid: true };
}

export function isCardPlayable(game: GameState, player: import('../shared/types').Player, card: Card): boolean {
  const def = cardDefMap.get(card.name);
  if (!def) return false;

  if (card.name === '杀') {
    const hasUnlimitedWeapon = player.equipment.weapon
      ? cardDefMap.get(player.equipment.weapon.name)?.weaponEffect?.type === 'unlimitedKills'
      : false;
    const hasUnlimitedSkill = player.character.abilities.some(a => a.modifiers?.includes('unlimitedKills'));
    if (game.killsPlayedThisTurn >= 1 && !hasUnlimitedWeapon && !hasUnlimitedSkill) {
      return false;
    }
  }

  if (card.name === '桃') {
    return player.health < player.maxHealth;
  }

  if (card.name === '闪') {
    return false;
  }

  return true;
}

export function getValidTargetsForCard(
  game: GameState,
  player: import('../shared/types').Player,
  card: Card,
): string[] {
  const def = cardDefMap.get(card.name);
  if (!def?.targetFilter) return [];

  const filter = def.targetFilter;
  const alivePlayers = getAlivePlayers(game);

  const candidates = (() => {
    switch (filter.type) {
      case 'self':
        return [player.name];
      case 'none':
        return [];
      case 'other':
        return alivePlayers
          .filter(p => p.name !== player.name)
          .filter(p => !filter.condition || filter.condition(p))
          .map(p => p.name);
      case 'inRange':
        return alivePlayers
          .filter(p => p.name !== player.name)
          .filter(p => isInAttackRange(game, player.name, p.name))
          .map(p => p.name);
      case 'all':
        return alivePlayers.map(p => p.name);
      default:
        return [];
    }
  })();

  return candidates.filter(targetName => !isTargetImmune(game, targetName, card));
}

function isTargetImmune(game: GameState, targetName: string, card: Card): boolean {
  const target = game.players.find(p => p.name === targetName);
  if (!target) return false;

  for (const ability of target.character.abilities) {
    if (ability.trigger !== 'onTargeted' || !ability.passive) continue;

    if (ability.name === '空城' && target.hand.length === 0) {
      if (card.name === '杀' || card.name === '决斗') return true;
    }

    if (ability.name === '谦逊') {
      if (card.name === '过河拆桥' || card.name === '顺手牵羊') return true;
    }
  }

  return false;
}

export function getValidActions(game: GameState, playerName: string): ValidActions {
  const player = getPlayer(game, playerName);

  const playableCards: Array<{ card: Card; targets: string[] }> = [];

  if (game.currentPlayer === playerName && game.phase === '出牌') {
    for (const card of player.hand) {
      if (isCardPlayable(game, player, card)) {
        const targets = getValidTargetsForCard(game, player, card);
        playableCards.push({ card, targets });
      }
    }

    const conversions = getConversionTargets(player, 'play');
    for (const conv of conversions) {
      if (isCardPlayable(game, player, conv.convertedCard)) {
        const targets = getValidTargetsForCard(game, player, conv.convertedCard);
        playableCards.push({ card: conv.convertedCard, targets });
      }
    }
  }

  const skills = getAvailableSkills(game, playerName);
  const canEndTurn = game.currentPlayer === playerName && game.phase === '出牌';
  const discardRequired = game.currentPlayer === playerName &&
    game.phase === '弃牌' &&
    player.hand.length > player.maxHealth;

  return {
    playableCards,
    skills,
    canEndTurn,
    discardRequired,
    discardCount: discardRequired ? player.hand.length - player.maxHealth : 0,
  };
}
