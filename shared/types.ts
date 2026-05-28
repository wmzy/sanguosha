// 卡牌花色
export type Suit = '♠' | '♥' | '♣' | '♦';

// 卡牌点数
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

// 卡牌类型
export type CardType = '基本牌' | '锦囊牌' | '装备牌';

// 卡牌子类型
export type CardSubType = '杀' | '闪' | '桃' | '锦囊' | '武器' | '防具' | '马' | '进攻马' | '防御马';

// 锦囊子类型
export type TrickSubType = '普通锦囊' | '延时锦囊' | '响应锦囊';

// 卡牌
export interface Card {
  name: string; // "杀", "闪", "桃" — 唯一标识
  type: CardType;
  subtype: CardSubType;
  suit: Suit;
  rank: Rank;
  description: string;
  range?: number; // 武器攻击范围
  trickSubtype?: TrickSubType;
  _original?: Card;
  _conversion?: string;
}

// 延时锦囊（判定区等待判定的锦囊）
export interface PendingTrick {
  name: string;
  source: string;
  card: Card;
}

// 卡牌转换技能过滤器
export interface CardFilter {
  name?: string[];
  suit?: Suit[];
  color?: 'red' | 'black';
}

// 卡牌转换技能配置
export interface CardConversion {
  name: string;
  from: CardFilter;
  to: string;
  context: 'play' | 'response' | 'any';
}

// 角色性别
export type Gender = '男' | '女';

// 势力
export type Faction = '魏' | '蜀' | '吴' | '群';

// 身份
export type Role = '主公' | '忠臣' | '反贼' | '内奸';

// 回合阶段
export type TurnPhase = '准备' | '判定' | '摸牌' | '出牌' | '弃牌' | '结束';

// 触发时机
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

// 效果定义（可辨识联合类型）
export type Effect =
  | { type: 'draw'; count: number | 'sameAsDiscarded' }
  | { type: 'dealDamage'; amount?: number; target?: string; condition?: string; bonusDamage?: number }
  | { type: 'heal'; target: string; amount: number }
  | { type: 'discard'; count: number | 'any'; target?: string }
  | { type: 'gainCard'; source: string; count?: number }
  | { type: 'skipPhase'; target?: string }
  | { type: 'conditional'; condition: Condition; then: Effect; else?: Effect }
  | { type: 'sequence'; steps: Effect[] }
  | { type: 'giveCards'; count: number | 'any'; target: string }
  | { type: 'skipDraw' }
  | { type: 'judge'; condition?: string; expectedSuit?: string; repeatOnBlack?: boolean; redResult?: string; failEffect?: string }
  | { type: 'convert'; from: string; to: string }
  | { type: 'redirect'; from: string; to: string }
  | { type: 'lookAtTopCards'; count: number | string };

// 条件定义
export interface Condition {
  phase?: TurnPhase;
  hasHandCards?: boolean;
  cardsGivenThisPhase?: { gte?: number; lte?: number };
  targetCard?: string;
  [key: string]: unknown;
}

// 技能配置
export interface AbilityConfig {
  name: string; // "奸雄", "仁德" — 唯一标识
  description: string;
  trigger: TriggerType;
  condition?: Condition;
  effect: Effect;
  oncePerTurn?: boolean;
  passive?: boolean;
}

// 角色配置
export interface CharacterConfig {
  name: string; // "曹操", "刘备" — 唯一标识
  maxHealth: number;
  gender: Gender;
  faction: Faction;
  abilities: AbilityConfig[];
}

// 装备槽
export interface Equipment {
  weapon?: Card;
  armor?: Card;
  horsePlus?: Card; // +1马
  horseMinus?: Card; // -1马
}

// 玩家
export interface Player {
  name: string;
  character: CharacterConfig;
  role: Role;
  health: number;
  maxHealth: number;
  hand: Card[];
  equipment: Equipment;
  alive: boolean;
  pendingTricks?: PendingTrick[];
}

// 游戏状态
export interface GameState {
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  currentPlayer: string; // player name
  phase: TurnPhase;
  round: number;
  status: '等待中' | '进行中' | '已结束';
  winner?: Role;
}

// 玩家可见状态（隐藏他人手牌）
export interface PublicGameState {
  players: Array<Omit<Player, 'hand'> & { handCount: number; hand?: Card[] }>;
  discardPile: Card[];
  currentPlayer: string;
  phase: TurnPhase;
  round: number;
  status: '等待中' | '进行中' | '已结束';
  winner?: Role;
}

// 提示类型
export type PromptType = 'select_player' | 'select_card' | 'select_yes_no' | 'select_option';

// 提示
export interface Prompt {
  name: string;
  description: string;
  type: PromptType;
  options: unknown[];
  timeout?: number;
}

// 玩家动作（可辨识联合类型）
export type PlayerAction =
  | { type: '出牌'; card: Card; target?: string }
  | { type: '发动技能'; skillName: string; target?: string }
  | { type: '结束回合' }
  | { type: '弃牌'; cards: Card[] }
  | { type: '响应'; card?: Card; target?: string };
