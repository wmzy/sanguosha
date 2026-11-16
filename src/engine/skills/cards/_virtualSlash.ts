// src/engine/skills/cards/_virtualSlash.ts — 「视为出杀」结算(无实体牌)。
// 自 util/skillRuntime 迁入:util 层不得 import skills/ 层(反向依赖),而本结算
// 需要 use-card 的 runUseFlow/chargeOnSettle,故落在 skills/cards/ 下。
// 8 个调用方:界乱武/界仁德/界惴恐/界明策/界求援/界神速/神速/蛊惑。
// 命名:函数名英文;业务字面量(牌名 '杀'、牌型 '基本牌')保持中文。
import type { Card, GameState } from '../../types';
import { runUseFlow, chargeOnSettle } from './use-card';

export interface RunVirtualSlashOptions {
  /** 虚拟杀 cardId 前缀(技能名):最终 id 为 `${prefix}:杀:${source}:${target}:${state.seq}` */
  prefix: string;
  /** 是否计入出杀次数(挂 chargeOnSettle 计费,由 杀.onSettle→incSlashUsed 累加)。默认不计。 */
  charge?: boolean;
  /** 借用真实牌的花色/颜色/点数/伤害属性(蛊惑:扣牌当杀,仁王盾按物理花色判假杀、
   *  火杀保留火焰伤害)。缺省为无色 'A'(原有语义:type 恒为 '基本牌',不借牌型)。 */
  physicalCard?: Card;
}

/**
 * 执行一次"视为出杀"的完整结算(无实体牌,runUseFlow virtual 模式):
 * 指定目标→成为目标→检测有效性→询问闪→伤害/抵消,时机 atom 序列与实体杀一致。
 * 虚拟杀无实体,但结算流程中 atoms/toViewEvents 需要 cardMap[id] 存在,故先写入、结算后删除(不入弃牌堆)。
 * 不消耗手牌、无距离限制(调用方已选定目标,不再校验距离)。
 *
 * @returns 是否对 target 造成了伤害(结算前后体力差比对;防具/反馈/奸雄等可能改伤)。
 *          不关心该结果的调用方可直接忽略返回值。
 */
export async function runVirtualSlash(
  state: GameState,
  source: number,
  target: number,
  opts: RunVirtualSlashOptions,
): Promise<boolean> {
  if (!state.players[target]?.alive) return false;
  const targetHealthBefore = state.players[target].health;
  const cardId = `${opts.prefix}:杀:${source}:${target}:${state.seq}`;
  const physical = opts.physicalCard;
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: physical?.suit ?? '',
    color: physical?.color ?? '无色',
    rank: physical?.rank ?? 'A',
    type: '基本牌',
    ...(physical?.damageType !== undefined ? { damageType: physical.damageType } : {}),
  };
  await runUseFlow(state, source, cardId, [target], '杀', {
    virtual: true,
    onSettle: opts.charge ? chargeOnSettle(state, source, cardId) : undefined,
  });
  delete state.cardMap[cardId];
  return state.players[target].health < targetHealthBefore;
}
