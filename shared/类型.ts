// 卡牌花色
export type Suit = '♠' | '♥' | '♣' | '♦';

// 卡牌点数
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

// 卡牌类型
export type CardType = '基本牌' | '锦囊牌' | '装备牌';

// 卡牌子类型
export type CardSubType = '杀' | '闪' | '桃' | '锦囊' | '武器' | '防具' | '马';

// 卡牌
export interface Card {
  name: string;           // "杀", "闪", "桃" — 唯一标识
  类型: CardType;
  子类型: CardSubType;
  花色: Suit;
  点数: Rank;
  描述: string;
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
  | 'manual';

// 效果类型
export type EffectType =
  | 'draw'
  | 'dealDamage'
  | 'heal'
  | 'discard'
  | 'gainCard'
  | 'skipPhase'
  | 'conditional'
  | 'sequence'
  | 'giveCards';

// 效果定义
export interface Effect {
  type: EffectType;
  [key: string]: unknown;
}

// 条件定义
export interface Condition {
  phase?: TurnPhase;
  hasHandCards?: boolean;
  cardsGivenThisPhase?: { gte?: number; lte?: number };
  [key: string]: unknown;
}

// 技能配置
export interface AbilityConfig {
  name: string;           // "奸雄", "仁德" — 唯一标识
  description: string;
  trigger: TriggerType;
  condition?: Condition;
  effect: Effect;
  oncePerTurn?: boolean;
  passive?: boolean;
}

// 角色配置
export interface CharacterConfig {
  name: string;           // "曹操", "刘备" — 唯一标识
  maxHealth: number;
  gender: Gender;
  faction: Faction;
  abilities: AbilityConfig[];
}

// 装备槽
export interface Equipment {
  武器?: Card;
  防具?: Card;
  马加?: Card;   // +1马
  马减?: Card;   // -1马
}

// 玩家
export interface Player {
  name: string;
  角色: CharacterConfig;
  身份: Role;
  体力: number;
  体力上限: number;
  手牌: Card[];
  装备: Equipment;
  存活: boolean;
}

// 游戏状态
export interface GameState {
  玩家列表: Player[];
  牌堆: Card[];
  弃牌堆: Card[];
  当前玩家: string;       // player name
  当前阶段: TurnPhase;
  回合数: number;
  状态: '等待中' | '进行中' | '已结束';
  获胜身份?: Role;
}

// 玩家可见状态（隐藏他人手牌）
export interface PublicGameState {
  玩家列表: Array<Omit<Player, '手牌'> & { 手牌数量: number; 手牌?: Card[] }>;
  弃牌堆: Card[];
  当前玩家: string;
  当前阶段: TurnPhase;
  回合数: number;
  状态: '等待中' | '进行中' | '已结束';
  获胜身份?: Role;
}

// 提示类型
export type PromptType = 'select_player' | 'select_card' | 'select_yes_no' | 'select_option';

// 提示
export interface Prompt {
  name: string;
  描述: string;
  类型: PromptType;
  选项: unknown[];
  超时?: number;
}

// 玩家动作
export type PlayerActionType = '出牌' | '发动技能' | '结束回合' | '弃牌' | '响应';

export interface PlayerAction {
  类型: PlayerActionType;
  卡牌?: Card;
  目标?: string;       // player name
  技能名?: string;
  [key: string]: unknown;
}
