export type Suit = '♠' | '♥' | '♣' | '♦';

export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export type CardType = '基本牌' | '锦囊牌' | '装备牌';

export type CardSubType = '杀' | '闪' | '桃' | '锦囊' | '武器' | '防具' | '马' | '进攻马' | '防御马';

export type TrickSubType = '普通锦囊' | '延时锦囊' | '响应锦囊';

export interface Card {
  id: string;
  name: string;
  type: CardType;
  subtype: CardSubType;
  suit: Suit;
  rank: Rank;
  description: string;
  range?: number;
  trickSubtype?: TrickSubType;
  _original?: Card;
  _conversion?: string;
}

export interface PendingTrick {
  name: string;
  source: string;
  card: Card;
}

export type Gender = '男' | '女';

export type Faction = '魏' | '蜀' | '吴' | '群';

export type Role = '主公' | '忠臣' | '反贼' | '内奸';

export type TurnPhase = '准备' | '判定' | '摸牌' | '出牌' | '弃牌' | '结束' | '回合结束';

export type EffectPrimitive =
  | { type: '摸牌'; count: number | string }
  | { type: 'damage'; amount: number; damageType?: '普通' | '雷电' | '火焰' }
  | { type: '回复体力'; amount: number; target?: string }
  | { type: '弃置'; source?: string; count: number | 'any'; target?: string }
  | { type: '获得'; from?: string; source?: 'damageSourceCard' | 'attacker' | 'judgeCard' | 'otherPlayers' | 'selected' | 'deck'; count?: number }
  | { type: 'skipPhase'; phase?: TurnPhase; target?: string }
  | { type: 'skipDraw' }
  | { type: '判定'; condition?: string; expectedSuit?: string; repeatOnBlack?: boolean; redResult?: string; failEffect?: string; onSuccess?: Effect; onFail?: Effect }
  | { type: '添加延时锦囊'; trickName: string; target: string }
  | { type: 'convert'; from: string; to: string }
  | { type: 'redirect'; from: string; to: string }
  | { type: 'giveCards'; count: number | 'any'; target: string }
  | { type: 'lookAtTopCards'; count: number | string }
  | { type: 'dealDamage'; amount?: number; target?: string; condition?: string; bonusDamage?: number };

export type Effect =
  | EffectPrimitive
  | { type: 'sequence'; steps: Effect[] }
  | { type: 'conditional'; condition: Condition; then: Effect; else?: Effect };

export interface CardDef {
  name: string;
  type: CardType;
  subtype: CardSubType;
  targetFilter?: TargetFilter;
  effect: Effect;
  responseWindow?: 'kill_response' | 'trick_response';
  aoeResponse?: string;
  usageLimit?: { perTurn?: number };
  range?: number;
  weaponEffect?: WeaponEffect;
  armorEffect?: ArmorEffect;
}

export interface TargetFilter {
  type: 'self' | 'other' | 'all' | 'none' | 'inRange';
  condition?: (player: { hand: unknown[] }) => boolean;
}

export interface WeaponEffect {
  type: '诸葛连弩' | '青釭剑' | '青龙偃月刀' | '贯石斧' | '雌雄双股剑';
}

export interface ArmorEffect {
  type: '八卦阵' | '仁王盾';
}

export interface Condition {
  phase?: TurnPhase;
  hasHandCards?: boolean;
  cardsGivenThisPhase?: { gte?: number; lte?: number };
  targetCard?: string;
  cardType?: string;
  杀UsedThisTurn?: boolean;
}

export interface AbilityConfig {
  name: string;
  description: string;
  trigger: TriggerType;
  condition?: Condition;
  effect: Effect;
  oncePerTurn?: boolean;
  passive?: boolean;
  modifiers?: string[];
}

export type TriggerType =
  | 'onDamageReceived'
  | 'onDamageDealt'
  | 'onTurnStart'
  | 'onTurnEnd'
  | 'onCardPlayed'
  | 'onCardDrawn'
  | 'onKill'
  | 'onDeath'
  | 'onHealReceived'
  | 'onJudge'
  | 'onTargeted'
  | 'onHandEmpty'
  | 'onEquipChange'
  | 'manual';

export interface CharacterConfig {
  name: string;
  maxHealth: number;
  gender: Gender;
  faction: Faction;
  abilities: AbilityConfig[];
}
