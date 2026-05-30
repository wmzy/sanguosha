import type { Card, Suit, Rank } from './types';
import type { Rng } from './rng';

const suits: Suit[] = ['♠', '♥', '♣', '♦'];
const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function card(name: string, type: Card['type'], subtype: Card['subtype'], suit: Suit, rank: Rank): Card {
  return { name, type, subtype, suit, rank, description: '', id: `${name}-${suit}-${rank}` };
}

export function createStandardDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;

  function add(name: string, type: Card['type'], subtype: Card['subtype'], count: number, suitList?: Suit[]) {
    const ss = suitList ?? suits;
    for (let i = 0; i < count; i++) {
      const s = ss[i % ss.length];
      const r = ranks[(id++) % ranks.length];
      deck.push({ name, type, subtype, suit: s, rank: r, description: '', id: `${name}-${s}-${r}-${deck.length}` });
    }
  }

  add('杀', '基本牌', '杀', 30);
  add('闪', '基本牌', '闪', 15, ['♥', '♦']);
  add('桃', '基本牌', '桃', 8, ['♥']);

  add('过河拆桥', '锦囊牌', '锦囊', 6);
  add('顺手牵羊', '锦囊牌', '锦囊', 5);
  add('无中生有', '锦囊牌', '锦囊', 4);
  add('决斗', '锦囊牌', '锦囊', 3);
  add('万箭齐发', '锦囊牌', '锦囊', 1);
  add('南蛮入侵', '锦囊牌', '锦囊', 3);
  add('桃园结义', '锦囊牌', '锦囊', 1);
  add('五谷丰登', '锦囊牌', '锦囊', 2);
  add('乐不思蜀', '锦囊牌', '锦囊', 1, ['♥']);
  add('兵粮寸断', '锦囊牌', '锦囊', 1, ['♣']);
  add('闪电', '锦囊牌', '锦囊', 2, ['♠']);
  add('无懈可击', '锦囊牌', '锦囊', 4);

  add('诸葛连弩', '装备牌', '武器', 1, ['♠', '♣']);
  add('青釭剑', '装备牌', '武器', 1, ['♠']);
  add('雌雄双股剑', '装备牌', '武器', 1, ['♠']);
  add('贯石斧', '装备牌', '武器', 1, ['♠']);
  add('青龙偃月刀', '装备牌', '武器', 1, ['♠']);
  add('丈八蛇矛', '装备牌', '武器', 1, ['♠']);
  add('方天画戟', '装备牌', '武器', 1, ['♦']);
  add('麒麟弓', '装备牌', '武器', 1, ['♥']);

  add('八卦阵', '装备牌', '防具', 2, ['♠', '♣']);
  add('仁王盾', '装备牌', '防具', 1, ['♣']);

  add('赤兔', '装备牌', '进攻马', 1, ['♥']);
  add('紫骍', '装备牌', '进攻马', 1, ['♦']);
  add('大宛', '装备牌', '进攻马', 1, ['♠']);
  add('的卢', '装备牌', '防御马', 1, ['♣']);
  add('绝影', '装备牌', '防御马', 1, ['♠']);
  add('爪黄飞电', '装备牌', '防御马', 1, ['♥']);

  return deck;
}

export function shuffle(deck: Card[], rng: Rng): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function drawCards(deck: Card[], count: number): { drawn: Card[]; remaining: Card[] } {
  const drawn = deck.slice(0, count);
  const remaining = deck.slice(count);
  return { drawn, remaining };
}

export function discardCards(discardPile: Card[], cards: Card[]): Card[] {
  return [...discardPile, ...cards];
}
