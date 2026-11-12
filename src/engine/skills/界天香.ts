// 界天香(界小乔·被动触发):当你受到伤害时，你可以弃置一张红桃牌防止之并选择一项，
//   令一名其他角色：1.受到伤害来源的1点伤害并摸X张牌（X为其已损失体力值且至多为5）；
//   2.失去1点体力并获得你弃置的牌。
//
// 官方来源:三国杀 OL 界限突破 hero/457(逐字)。
//
// 共享实现与标版差异配置见 天香.ts(registerTianxiangWiring)。界版真实差异:
//   1. 候选区=手牌**或装备区**的红桃牌(标版仅手牌);choose 询问的 cardFilter 显式
//      携带 candidates——投影层 resolveCardFilterCandidates 仅遍历 player.hand,
//      会漏掉装备区红桃牌 → view-projection desync,必须下发含装备区的权威候选列表。
//   2. 选项①固定 1 点伤害(官方:非原伤害值,保留原来源/原伤害属性;天香.test 注释明确)。
//   3. respond 校验含 owner 存活检查('玩家不可用')。
// 其余(respond validate/execute 骨架、before-hook 六步流程、红桃判定认 红颜|界红颜)
// 与标版共用 天香.ts 的参数化实现。
import type { FrontendAPI, GameState, PlayerState, Skill } from '../types';
import { registerTianxiangWiring, mountTianxiangRespondAction, type TianxiangVariant } from './天香';

/** 界版:红桃牌可在手牌或装备区。返回玩家拥有的所有 cardId(手牌 + 装备区)。 */
function getOwnedCardIds(self: PlayerState): string[] {
  const equipIds = Object.values(self.equipment).filter(
    (id): id is string => typeof id === 'string',
  );
  return [...self.hand, ...equipIds];
}

/** 玩家是否持有某张牌(手牌或装备区)。 */
function ownsCard(self: PlayerState, cardId: string): boolean {
  if (self.hand.includes(cardId)) return true;
  return Object.values(self.equipment).some((id) => id === cardId);
}

/** 界天香差异配置(共享实现见 天香.ts)。 */
const JIE_VARIANT: TianxiangVariant = {
  name: '界天香',
  notAskError: '当前不是界天香询问',
  askCardError: '请选择一张红桃牌',
  ownerAliveError: '玩家不可用',
  cardNotOwnedError: '牌不在手牌或装备区',
  cardNotRedError: '必须选择红桃牌',
  askTargetError: '请选择一名其他角色',
  selfTargetError: '不能选择自己',
  confirmTitle: '是否发动界天香(弃红桃牌防止伤害)?',
  chooseTitle: '界天香:弃一张红桃牌(手牌或装备区),选择一名其他角色',
  candidateCardIds: (self) => getOwnedCardIds(self),
  ownsCard,
  explicitCandidates: true,
  optionDamageAmount: () => 1,
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界天香',
    description:
      '受到伤害时,弃一张红桃牌防止之,令一名其他角色二选一:①受来源1伤害并摸X(X为已损失体力至多5);②失去1体力并获得弃置的牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  registerTianxiangWiring(skill, state, JIE_VARIANT);
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  mountTianxiangRespondAction(api, '界天香', '是否发动界天香?');
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
