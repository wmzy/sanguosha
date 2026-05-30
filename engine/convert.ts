import type { Card, Player, Suit } from '../shared/types';

export interface ConversionOption {
  originalCard: Card;
  convertedCard: Card;
  skillName: string;
}

function isBlack(suit: Suit): boolean {
  return suit === '♠' || suit === '♣';
}

function isRed(suit: Suit): boolean {
  return suit === '♥' || suit === '♦';
}

function isSuitMatch(suit: Suit, filter: string): boolean {
  switch (filter) {
    case 'blackHandCard': return isBlack(suit);
    case 'redHandCard': return isRed(suit);
    case '♦handCard': return suit === '♦';
    default: return false;
  }
}

export function getConversionOptions(
  player: Player,
  targetName: string,
  context: 'play' | 'response' | 'any',
): ConversionOption[] {
  const options: ConversionOption[] = [];

  for (const ability of player.character.abilities) {
    if (ability.effect.type !== 'convert') continue;
    if (ability.passive) continue;

    const { from, to } = ability.effect;

    if (from === '杀闪互转') {
      if (context === 'play' || context === 'any') {
        for (const card of player.hand) {
          if (card.name === '闪') {
            options.push({
              originalCard: card,
              convertedCard: { ...card, name: '杀', subtype: '杀', _original: card, _conversion: '杀' },
              skillName: ability.name,
            });
          }
        }
      }
      if (context === 'response' || context === 'any') {
        for (const card of player.hand) {
          if (card.name === '杀') {
            options.push({
              originalCard: card,
              convertedCard: { ...card, name: '闪', subtype: '闪', _original: card, _conversion: '闪' },
              skillName: ability.name,
            });
          }
        }
      }
      continue;
    }

    const fromFilter = from;
    const toName = to;

    for (const card of player.hand) {
      if (isSuitMatch(card.suit, fromFilter)) {
        options.push({
          originalCard: card,
          convertedCard: { ...card, name: toName, _original: card, _conversion: toName },
          skillName: ability.name,
        });
      }
    }
  }

  return options.filter(opt => opt.convertedCard.name === targetName);
}

export function getConversionTargets(
  player: Player,
  context: 'play' | 'response' | 'any',
): ConversionOption[] {
  const options: ConversionOption[] = [];

  for (const ability of player.character.abilities) {
    if (ability.effect.type !== 'convert') continue;
    if (ability.passive) continue;

    const { from, to } = ability.effect;

    if (from === '杀闪互转') {
      if (context === 'play' || context === 'any') {
        for (const card of player.hand) {
          if (card.name === '闪') {
            options.push({
              originalCard: card,
              convertedCard: { ...card, name: '杀', subtype: '杀', _original: card, _conversion: '杀' },
              skillName: ability.name,
            });
          }
        }
      }
      if (context === 'response' || context === 'any') {
        for (const card of player.hand) {
          if (card.name === '杀') {
            options.push({
              originalCard: card,
              convertedCard: { ...card, name: '闪', subtype: '闪', _original: card, _conversion: '闪' },
              skillName: ability.name,
            });
          }
        }
      }
      continue;
    }

    const fromFilter = from;
    const toName = to;

    for (const card of player.hand) {
      if (isSuitMatch(card.suit, fromFilter)) {
        options.push({
          originalCard: card,
          convertedCard: { ...card, name: toName, _original: card, _conversion: toName },
          skillName: ability.name,
        });
      }
    }
  }

  return options;
}
