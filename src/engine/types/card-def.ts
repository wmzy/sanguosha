// engine/types/card-def.ts — 卡牌/技能声明式定义层(历史 DSL)。
// 原 shared/types.ts 中的声明式描述类型,随 shared/ 清退迁入引擎。
//
// 说明:Effect / CharacterConfig / AbilityConfig / TriggerType 这套声明式 DSL
// 是早期设计(见 docs/decisions/0013 Phase 4),当前引擎运行时已改用 SkillDef(命令式)为准;
// 此处保留仅因 CardDef.effect 字段仍被卡牌定义引用。
//
// 注意:原 shared 的 TargetFilter 在此重命名为 CardTargetFilter,
// 避免与 prompt.ts 的运行时 TargetFilter(min/max/filter)同名冲突(后者被前端广泛使用)。

import type { CardType, CardSubType, TurnPhase, Gender, Faction } from './state';

export type EffectPrimitive =
  | { type: '摸牌'; count: number | string }
  | { type: 'damage'; amount: number; damageType?: '普通' | '雷电' | '火焰' }
  | { type: '回复体力'; amount: number; target?: string }
  | { type: '弃置'; source?: string; count: number | 'any'; target?: string }
  | {
      type: '获得';
      from?: string;
      source?: 'damageSourceCard' | 'attacker' | 'judgeCard' | 'otherPlayers' | 'selected' | 'deck';
      count?: number;
    }
  | { type: 'skipPhase'; phase?: TurnPhase; target?: string }
  | { type: 'skipDraw' }
  | {
      type: '判定';
      condition?: string;
      expectedSuit?: string;
      repeatOnBlack?: boolean;
      redResult?: string;
      failEffect?: string;
      onSuccess?: Effect;
      onFail?: Effect;
    }
  | { type: '添加延时锦囊'; trickName: string; target: string }
  | { type: 'convert'; from: string; to: string }
  | { type: 'redirect'; from: string; to: string }
  | { type: 'giveCards'; count: number | 'any'; target: string }
  | { type: 'lookAtTopCards'; count: number | string }
  | {
      type: 'dealDamage';
      amount?: number;
      target?: string;
      condition?: string;
      bonusDamage?: number;
    };

export type Effect =
  | EffectPrimitive
  | { type: 'sequence'; steps: Effect[] }
  | { type: 'conditional'; condition: Condition; then: Effect; else?: Effect };

export interface CardTargetFilter {
  type: 'self' | 'other' | 'all' | 'none' | 'inRange';
  condition?: (player: { hand: unknown[] }) => boolean;
}

export interface CardDef {
  name: string;
  type: CardType;
  subtype: CardSubType;
  targetFilter?: CardTargetFilter;
  effect: Effect;
  responseWindow?: 'kill_response' | 'trick_response';
  aoeResponse?: string;
  usageLimit?: { perTurn?: number };
  range?: number;
  weaponEffect?: WeaponEffect;
  armorEffect?: ArmorEffect;
}

export interface WeaponEffect {
  type: '诸葛连弩' | '青釭剑' | '寒冰剑' | '青龙偃月刀' | '贯石斧' | '雌雄双股剑';
}

export interface ArmorEffect {
  type: '八卦阵' | '仁王盾' | '藤甲' | '白银狮子';
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
